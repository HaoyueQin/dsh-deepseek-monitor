/**
 * Platform-token service tests: verify-then-store ordering, status-code
 * classification and the write-only credential seam contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlatformTokenService, verifyUsageToken } from '../src/platform-token.ts'
import { DsmError } from '../src/wire.ts'

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

const credentials = { resolve: vi.fn(), describe: vi.fn(), set: vi.fn(), unset: vi.fn() }

afterEach(() => {
  vi.unstubAllGlobals()
  credentials.set.mockReset()
  credentials.unset.mockReset()
  credentials.describe.mockReset()
})

describe('verifyUsageToken', () => {
  it('accepts a 200 and rejects 401 / 429 / other statuses distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 200)))
    await expect(verifyUsageToken('tok')).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(verifyUsageToken('tok')).rejects.toMatchObject({ status: 401 })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    await expect(verifyUsageToken('tok')).rejects.toMatchObject({ status: 429 })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    await expect(verifyUsageToken('tok')).rejects.toMatchObject({ status: 502 })
  })

  it('classifies network failures as 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    await expect(verifyUsageToken('tok')).rejects.toMatchObject({ status: 502 })
  })
})

describe('createPlatformTokenService', () => {
  it('verifies BEFORE storing — an invalid token never lands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    const service = createPlatformTokenService({ credentials } as never)
    await expect(service.verifyAndStore('bad-token-1234567890')).rejects.toMatchObject({ status: 401 })
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('stores the trimmed value after verification passes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 200)))
    const service = createPlatformTokenService({ credentials } as never)
    await service.verifyAndStore('  tok-with-margin  ')
    expect(credentials.set).toHaveBeenCalledWith('DEEPSEEK_PLATFORM_TOKEN', 'tok-with-margin')
  })

  it('rejects an empty token with 400 before any verification', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const service = createPlatformTokenService({ credentials } as never)
    await expect(service.verifyAndStore('   ')).rejects.toMatchObject({ status: 400 })
    // The strict check must run before the fetch — no network for a blank.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('clear() unsets the reference; describe() reports configured state', async () => {
    const service = createPlatformTokenService({ credentials } as never)
    await service.clear()
    expect(credentials.unset).toHaveBeenCalledWith('DEEPSEEK_PLATFORM_TOKEN')

    credentials.describe.mockResolvedValueOnce({ configured: true, source: 'env', writable: true })
    await expect(service.describe()).resolves.toEqual({ configured: true, writable: true })

    credentials.describe.mockResolvedValueOnce({ configured: false, source: undefined, writable: false })
    await expect(service.describe()).resolves.toEqual({ configured: false })
  })

  it('never returns the token value on any surface', async () => {
    credentials.describe.mockResolvedValueOnce({ configured: true, source: 'env', writable: true })
    const service = createPlatformTokenService({ credentials } as never)
    expect(JSON.stringify(await service.describe())).not.toContain('tok')
  })
})

// Keep DsmError pinned: the status codes above are the wire contract.
void DsmError
