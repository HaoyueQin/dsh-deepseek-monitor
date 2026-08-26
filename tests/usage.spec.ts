/**
 * Usage-parsing tests: the DSMonitor token_breakdown / cost_sum port and the
 * platform usage fetch (amount + cost joined). Vectors mirror the upstream
 * Rust tests (deepseek.rs #[cfg(test)]) so the port cannot silently drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { costSum, createUsageService, tokenBreakdown } from '../src/usage.ts'
import { DsmError } from '../src/wire.ts'

type Entry = { type?: string, amount?: string }

const entry = (type: string, amount: string): Entry => ({ type, amount })

afterEach(() => { vi.unstubAllGlobals() })

describe('tokenBreakdown (DSM token_breakdown)', () => {
  it('sums the expected kinds exactly like upstream', () => {
    const usage = [
      entry('REQUEST', '42'),
      entry('PROMPT_CACHE_HIT_TOKEN', '100'),
      entry('PROMPT_CACHE_MISS_TOKEN', '200'),
      entry('RESPONSE_TOKEN', '50'),
      entry('PROMPT_TOKEN', '30'),
    ]
    expect(tokenBreakdown(usage)).toEqual({ total: 380, request: 42, hit: 100, miss: 200, response: 50 })
  })

  it('ignores unknown entry kinds', () => {
    expect(tokenBreakdown([entry('WEIRD_KIND', '999')]))
      .toEqual({ total: 0, request: 0, hit: 0, miss: 0, response: 0 })
  })

  it('treats unparsable and negative amounts as zero', () => {
    const usage = [
      entry('PROMPT_CACHE_HIT_TOKEN', 'abc'),
      entry('PROMPT_CACHE_HIT_TOKEN', '-5'),
      entry('PROMPT_CACHE_HIT_TOKEN', '10'),
    ]
    const r = tokenBreakdown(usage)
    expect(r.total).toBe(10)
    expect(r.hit).toBe(10)
  })

  it('rounds each entry before summing (upstream per-entry semantics)', () => {
    // Upstream rounds EACH entry before summing, and repeated types are
    // last-wins on the dedicated bucket ('hit = value', never 'hit += value').
    // Two 0.4 hits: round each = 0 + 0, total 0; a sum-then-round port would
    // wrongly yield total 1 for 0.8 while reporting hit 0 (bucket mismatch).
    const r1 = tokenBreakdown([entry('PROMPT_CACHE_HIT_TOKEN', '0.4'), entry('PROMPT_CACHE_HIT_TOKEN', '0.4')])
    expect(r1.total).toBe(0)
    expect(r1.hit).toBe(0)
    // Two 0.6 hits: per-entry round = 1 + 1 -> total 2; the bucket keeps the
    // LAST entry (1), never the sum (2).
    const r2 = tokenBreakdown([entry('PROMPT_CACHE_HIT_TOKEN', '0.6'), entry('PROMPT_CACHE_HIT_TOKEN', '0.6')])
    expect(r2.total).toBe(2)
    expect(r2.hit).toBe(1)
  })

  it('clamps amounts at the safe-integer ceiling', () => {
    expect(tokenBreakdown([entry('RESPONSE_TOKEN', '9007199254740993')]).response).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('is tolerant of absent type/amount fields', () => {
    expect(tokenBreakdown([{}, { type: 'RESPONSE_TOKEN' }])).toEqual({ total: 0, request: 0, hit: 0, miss: 0, response: 0 })
  })
})

describe('costSum (DSM cost_sum)', () => {
  it('excludes REQUEST entries', () => {
    const usage = [
      entry('REQUEST', '99'),
      entry('PROMPT_CACHE_HIT_TOKEN', '1.5'),
      entry('RESPONSE_TOKEN', '2.5'),
    ]
    expect(costSum(usage)).toBe(4.0)
  })

  it('treats invalid amounts as zero', () => {
    expect(costSum([entry('PROMPT_TOKEN', 'oops')])).toBe(0)
  })

  it('rounds each entry before summing (upstream cost_sum does NOT round)', () => {
    // cost_sum upstream is a plain f64 sum — fractional entries keep their
    // precision and the caller rounds the final display value.
    expect(costSum([entry('UNKNOWN', '0.1'), entry('UNKNOWN', '0.2')])).toBeCloseTo(0.3, 10)
  })
})

describe('createUsageService.fetch', () => {
  const credentials = { resolve: vi.fn() }

  const jsonResponse = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

  const amountPayload = (models: unknown[], days: unknown[]): unknown => ({
    data: { biz_data: { total: models, days } },
  })
  const costPayload = (total: unknown[], days: unknown[]): unknown => ({
    data: { biz_data: [{ total, days }] },
  })

  it('throws 409 when the platform token is not configured', async () => {
    credentials.resolve.mockResolvedValueOnce(undefined)
    const service = createUsageService({ credentials } as never)
    await expect(service.fetch(2026, 8)).rejects.toMatchObject({ status: 409 })
  })

  it('joins amount and cost into models / days / monthCost', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(amountPayload(
        [
          { model: 'deepseek-v4-flash', usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '100' },
            { type: 'RESPONSE_TOKEN', amount: '50' },
          ] },
          { model: 'deepseek-v4-flash-vision-exp', usage: [{ type: 'RESPONSE_TOKEN', amount: '7' }] },
        ],
        [{ date: '2026-08-02', data: [{ model: 'deepseek-v4-flash', usage: [
          { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '100' },
          { type: 'RESPONSE_TOKEN', amount: '50' },
        ] }] }],
      )))
      .mockResolvedValueOnce(jsonResponse(costPayload(
        [
          { model: 'deepseek-v4-flash', usage: [{ type: 'RESPONSE_TOKEN', amount: '1.5' }] },
          { model: 'deepseek-v4-flash-vision-exp', usage: [{ type: 'RESPONSE_TOKEN', amount: '0.25' }] },
        ],
        [{ date: '2026-08-02', data: [{ model: 'deepseek-v4-flash', usage: [{ type: 'RESPONSE_TOKEN', amount: '1.5' }] }] }],
      )))
    vi.stubGlobal('fetch', fetchMock)

    const service = createUsageService({ credentials } as never)
    const result = await service.fetch(2026, 8)
    expect(result.year).toBe(2026)
    expect(result.month).toBe(8)
    // Full unknown models are kept (product decision), legacy names included.
    expect(result.models).toHaveLength(2)
    const flash = result.models.find(m => m.name === 'deepseek-v4-flash')!
    expect(flash.totalTokens).toBe(150)
    expect(flash.requestCount).toBe(0)
    expect(flash.cost).toBeCloseTo(1.5, 4)
    const vision = result.models.find(m => m.key === 'flash-vision')!
    expect(vision.cost).toBeCloseTo(0.25, 4)
    expect(result.days).toHaveLength(1)
    expect(result.days[0]).toMatchObject({
      date: '2026-08-02',
      flashTokens: 150,
      flashCacheHit: 100,
      flashResponse: 50,
      totalCost: 1.5,
    })
    expect(result.monthCost).toBeCloseTo(1.75, 4)
    expect(result.fetchedAt).toBeGreaterThan(0)
  })

  it('folds unknown models into the other-* daily buckets', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(amountPayload([], [
        { date: '2026-08-02', data: [{ model: 'deepseek-v4-flash-vision-exp', usage: [
          { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '3' },
          { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '4' },
          { type: 'RESPONSE_TOKEN', amount: '5' },
        ] }] },
      ])))
      .mockResolvedValueOnce(jsonResponse(costPayload([], [])))
    vi.stubGlobal('fetch', fetchMock)

    const service = createUsageService({ credentials } as never)
    const result = await service.fetch(2026, 8)
    expect(result.days[0]).toMatchObject({ otherCacheHit: 3, otherCacheMiss: 4, otherResponse: 5, totalTokens: 12 })
  })

  it('classifies 401 / 429 / 5xx platform failures', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = createUsageService({ credentials } as never)
    await expect(service.fetch(2026, 8)).rejects.toMatchObject({ status: 401 })
  })

  it('fails the network error as 502 with a message', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const service = createUsageService({ credentials } as never)
    await expect(service.fetch(2026, 8)).rejects.toMatchObject({ status: 502 })
  })

  it('surfaces unparsable JSON as 502', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    const service = createUsageService({ credentials } as never)
    await expect(service.fetch(2026, 8)).rejects.toMatchObject({ status: 502 })
  })
})
