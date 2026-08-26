/**
 * Balance-service tests: TTL cache, in-flight join, force semantics, error
 * classification and the credential seam — the contract the refresher and the
 * panel depend on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBalanceService } from '../src/balance.ts'
import { DsmError } from '../src/wire.ts'

const OK_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
    { currency: 'CNY', total_balance: '12.34', granted_balance: '1.00', topped_up_balance: '11.34' },
  ],
}

const jsonResponse = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
})

const credentials = { resolve: vi.fn(), describe: vi.fn() }

afterEach(() => {
  vi.unstubAllGlobals()
  credentials.resolve.mockReset()
})

describe('createBalanceService', () => {
  it('fetches on the first read and serves the TTL cache afterwards', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(OK_BODY))
    vi.stubGlobal('fetch', fetchMock)
    const service = createBalanceService({ credentials } as never)

    const first = await service.get(false)
    expect(first).toMatchObject({ totalBalance: '12.34', currency: 'CNY', isAvailable: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Within the 60s TTL and no error: cache-only.
    const second = await service.get(false)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('force bypasses the TTL and re-fetches', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    // A fresh Response per call: Response bodies are single-use.
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(OK_BODY)))
    vi.stubGlobal('fetch', fetchMock)
    const service = createBalanceService({ credentials } as never)

    await service.get(false)
    await service.get(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('joins concurrent callers into one in-flight fetch', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    let release!: (value: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const service = createBalanceService({ credentials } as never)

    const a = service.get(false)
    const b = service.get(false)
    const c = service.get(true)
    // The fetch call happens after the credential resolve microtask.
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    release(jsonResponse(OK_BODY))
    const [ra, rb, rc] = await Promise.all([a, b, c])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ra).toBe(rb)
    expect(rc).toBe(ra)
  })

  it('records the failure and lets the next call retry; lastError clears on success', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse(OK_BODY))
    vi.stubGlobal('fetch', fetchMock)
    const service = createBalanceService({ credentials } as never)

    await expect(service.get(false)).rejects.toMatchObject({ status: 401 })
    expect(service.lastError()).toBe('API Key 无效或已过期')
    expect(service.peek()).toBeNull()

    // A failed read must not poison the cache: the next call re-fetches.
    const recovered = await service.get(false)
    expect(recovered.totalBalance).toBe('12.34')
    expect(service.lastError()).toBe('')
    expect(service.peek()).not.toBeNull()
  })

  it('classifies 429 and network failures', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    const service = createBalanceService({ credentials } as never)
    await expect(service.get(false)).rejects.toMatchObject({ status: 429 })

    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))
    await expect(service.get(false)).rejects.toMatchObject({ status: 502 })
  })

  it('throws 409 when the API key reference is unconfigured', async () => {
    credentials.resolve.mockResolvedValue(undefined)
    const service = createBalanceService({ credentials } as never)
    await expect(service.get(false)).rejects.toMatchObject({ status: 409 })
    expect(service.lastError()).toContain('API Key')
  })

  it('rejects a malformed upstream shape with 502 and never stores a partial snapshot', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-test', source: 'env' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      is_available: true,
      balance_infos: [],
    })))
    const service = createBalanceService({ credentials } as never)
    await expect(service.get(false)).rejects.toMatchObject({ status: 502 })
    expect(service.peek()).toBeNull()
  })

  it('uses a custom key reference when configured', async () => {
    credentials.resolve.mockResolvedValue({ value: 'sk-alt', source: 'env' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(OK_BODY)))
    const service = createBalanceService({ credentials, keyRef: 'MY_DS_KEY' } as never)
    await service.get(false)
    expect(credentials.resolve).toHaveBeenCalledWith('MY_DS_KEY')
  })
})

// DsmError is imported to keep the wire contract pinned in this suite.
void DsmError
