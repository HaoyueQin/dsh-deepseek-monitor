/**
 * Usage-parsing tests: the DSMonitor token_breakdown / cost_sum port and the
 * platform usage fetch (amount + cost joined). Vectors mirror the upstream
 * Rust tests (deepseek.rs #[cfg(test)]) so the port cannot silently drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUCKETS_KEY, costSum, createUsageService, tokenBreakdown } from '../src/usage.ts'
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

  it('keeps the last entry of a repeated kind, as upstream does', () => {
    // Locked on purpose: the buckets are NOT running sums. If someone makes
    // them accumulate, they must also change how `total` sums, or the two
    // disagree on the same payload.
    expect(tokenBreakdown([entry('REQUEST', '2'), entry('REQUEST', '3')]))
      .toEqual({ total: 0, request: 3, hit: 0, miss: 0, response: 0 })
    expect(tokenBreakdown([entry('RESPONSE_TOKEN', '4'), entry('RESPONSE_TOKEN', '1')]))
      .toEqual({ total: 5, request: 0, hit: 0, miss: 0, response: 1 })
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
    const flash = result.models.find(m => m.key === 'v4-flash')!
    expect(flash.name).toBe('DeepSeek-V4-Flash')
    expect(flash.totalTokens).toBe(150)
    expect(flash.requestCount).toBe(0)
    expect(flash.cost).toBeCloseTo(1.5, 4)
    const vision = result.models.find(m => m.key === 'flash-vision')!
    expect(vision.name).toBe('DeepSeek-V4-Flash-Vision-Exp')
    expect(vision.cost).toBeCloseTo(0.25, 4)
    expect(result.days).toHaveLength(1)
    expect(result.days[0]).toMatchObject({
      date: '2026-08-02',
      totalCost: 1.5,
      buckets: { 'v4-flash': { hit: 100, miss: 0, response: 50 } },
    })
    expect(result.monthCost).toBeCloseTo(1.75, 4)
    expect(result.fetchedAt).toBeGreaterThan(0)
  })

  it('skips the retired chat/reasoner rows without dropping their tokens', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(amountPayload(
        [
          { model: 'deepseek-chat & deepseek-reasoner', usage: [{ type: 'RESPONSE_TOKEN', amount: '9' }] },
          { model: 'deepseek-v4-flash', usage: [{ type: 'RESPONSE_TOKEN', amount: '1' }] },
        ],
        [{ date: '2026-08-02', data: [{ model: 'deepseek-chat & deepseek-reasoner', usage: [{ type: 'RESPONSE_TOKEN', amount: '9' }] }] }],
      )))
      .mockResolvedValueOnce(jsonResponse(costPayload([], [])))
    vi.stubGlobal('fetch', fetchMock)

    const service = createUsageService({ credentials } as never)
    const result = await service.fetch(2026, 8)
    // No row is advertised for the retired pair ...
    expect(result.models.map(m => m.key)).toEqual(['v4-flash'])
    // ... yet its tokens still reach the day total and the chart buckets.
    expect(result.days[0].totalTokens).toBe(9)
    expect(result.days[0].buckets).toEqual({ other: { hit: 0, miss: 0, response: 9 } })
  })

  it('folds ids with no panel row into the other bucket', async () => {
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
    // The vision exp HAS a row, so it lands under its own key — not "other".
    expect(result.days[0].buckets).toEqual({ 'flash-vision': { hit: 3, miss: 4, response: 5 } })
    expect(result.days[0].totalTokens).toBe(12)
  })

  it('pools the V4.1 Flash account-period ids into ONE row and ONE bucket', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    // The platform reports the same model under a dated id before it switches
    // to the official one; splitting them would cut one model's usage in half.
    const dated = 'deepseek-v4.1-flash-expires-on-0910'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(amountPayload(
        [
          { model: dated, usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '1000' },
            { type: 'RESPONSE_TOKEN', amount: '500' },
          ] },
          { model: 'deepseek-flash', usage: [{ type: 'PROMPT_CACHE_HIT_TOKEN', amount: '200' }] },
        ],
        [{ date: '2026-08-02', data: [
          { model: dated, usage: [{ type: 'PROMPT_CACHE_HIT_TOKEN', amount: '1000' }] },
          { model: 'deepseek-flash', usage: [{ type: 'PROMPT_CACHE_HIT_TOKEN', amount: '200' }] },
        ] }],
      )))
      .mockResolvedValueOnce(jsonResponse(costPayload([
        { model: dated, usage: [{ type: 'RESPONSE_TOKEN', amount: '2.5' }] },
        { model: 'deepseek-flash', usage: [{ type: 'RESPONSE_TOKEN', amount: '0.5' }] },
      ], [])))
    vi.stubGlobal('fetch', fetchMock)

    const service = createUsageService({ credentials } as never)
    const result = await service.fetch(2026, 8)
    // ONE row for the model, even though the platform reported it twice.
    expect(result.models).toHaveLength(1)
    expect(result.models[0]).toMatchObject({
      key: 'v41-flash',
      name: 'DeepSeek-V4.1-Flash',
      totalTokens: 1700,
      cost: 3,
    })
    // Both ids fold into the same daily bucket instead of one falling to other.
    expect(result.days[0].buckets).toEqual({ 'v41-flash': { hit: 1200, miss: 0, response: 0 } })
  })

  it('books an unrecognised platform id under the other bucket', async () => {
    credentials.resolve.mockResolvedValue({ value: 'tok', source: 'env' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(amountPayload([], [
        { date: '2026-08-02', data: [{ model: 'deepseek-v5-not-in-this-build', usage: [
          { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '3' },
          { type: 'RESPONSE_TOKEN', amount: '5' },
        ] }] },
      ])))
      .mockResolvedValueOnce(jsonResponse(costPayload([], [])))
    vi.stubGlobal('fetch', fetchMock)

    const service = createUsageService({ credentials } as never)
    const result = await service.fetch(2026, 8)
    // A model newer than this build keeps its tokens in the chart's total
    // rather than vanishing from it (BUCKETS_KEY is the shared catch-all key).
    expect(result.days[0].buckets).toEqual({ [BUCKETS_KEY]: { hit: 3, miss: 0, response: 5 } })
    expect(result.days[0].totalTokens).toBe(8)
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
