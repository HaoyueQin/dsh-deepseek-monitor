import { describe, expect, it, vi } from 'vitest'
import { buildMonitorRoute } from '../src/routes.ts'
import { DEFAULT_PREFS, type BalanceSnapshot } from '../src/wire.ts'

const snap = (): BalanceSnapshot => ({
  isAvailable: true,
  currency: 'CNY',
  totalBalance: '9.99',
  grantedBalance: '0.00',
  toppedUpBalance: '9.99',
  fetchedAt: 1,
})

interface Res { statusCode: number; body?: string }

function makeReq(url: string, method = 'GET', body?: unknown): any {
  return {
    url,
    method,
    headers: { host: 'localhost:3080' },
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield JSON.stringify(body)
    },
  }
}

function makeRes(): Res & { writeHead(code: number): void; end(b?: string): void } {
  const res = {
    statusCode: 0,
    body: undefined as string | undefined,
    writeHead(code: number) { res.statusCode = code },
    end(b?: string) { res.body = b },
  }
  return res
}

function buildServices() {
  const balanceGet = vi.fn(async (force: boolean) => snap())
  const prefsUpdate = vi.fn(async (patch: Record<string, unknown>) => ({ ...DEFAULT_PREFS, ...patch }))
  const services = {
    routes: { get: () => undefined },
    balance: { get: balanceGet, peek: snap, lastError: () => '' },
    usage: { get: async () => ({ year: 2026, month: 8, models: [], days: [], monthCost: 0, fetchedAt: 1 }) },
    platformToken: { verifyAndStore: async () => undefined, clear: async () => undefined, describe: async () => ({ configured: false }) },
    apiKeyState: async () => ({ configured: true }),
    prefs: { get: () => DEFAULT_PREFS, update: prefsUpdate },
    cache: { clear: async () => undefined, refreshAll: async () => undefined },
    lowBalance: () => false,
    refresherError: () => '',
  }
  return { services, balanceGet, prefsUpdate }
}

async function call(url: string, method = 'GET', body?: unknown) {
  const { services, ...spies } = buildServices()
  const route = buildMonitorRoute({} as never, 'test', services as never)
  const req = makeReq(url, method, body)
  const res = makeRes()
  await route.handler(req as never, res as never)
  return { res, ...spies }
}

describe('/dsm/api fence', () => {
  it('refuses untrusted hosts before touching services', async () => {
    const { services } = buildServices()
    const route = buildMonitorRoute({} as never, 'test', services as never)
    const req = { ...makeReq('/dsm/api/status'), headers: { host: 'evil.example' } }
    const res = makeRes()
    await route.handler(req as never, res as never)
    expect(res.statusCode).toBe(403)
  })
})

describe('/dsm/api/balance force semantics', () => {
  it('defaults to a CACHED read when the flag is missing', async () => {
    const { balanceGet } = await call('/dsm/api/balance', 'POST', {})
    expect(balanceGet).toHaveBeenCalledWith(false)
  })

  it('hits upstream only on an explicit force:true', async () => {
    const { balanceGet } = await call('/dsm/api/balance', 'POST', { force: true })
    expect(balanceGet).toHaveBeenCalledWith(true)
  })
})

describe('POST /dsm/api/prefs sanitization', () => {
  it('drops unknown keys and clamps the interval floor to 60s', async () => {
    const { prefsUpdate } = await call('/dsm/api/prefs', 'POST', {
      refreshIntervalSeconds: 5,
      lowBalanceThreshold: 3.5,
      evilKey: 'x',
      autoRefreshEnabled: 'not-a-boolean',
    })
    expect(prefsUpdate).toHaveBeenCalledWith({
      refreshIntervalSeconds: 60,
      lowBalanceThreshold: 3.5,
    })
  })
})

describe('unknown endpoints', () => {
  it('answer 404 after consuming the body', async () => {
    const { res } = await call('/dsm/api/nope', 'POST', { x: 1 })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body ?? '{}').error.code).toBe('dsm_api_error')
  })

  it('a nested lookalike path no longer falls into a known branch', async () => {
    // Suffix matching used to serve /status for ANY url ending in /status.
    const { res } = await call('/dsm/api/evil/status')
    expect(res.statusCode).toBe(404)
  })

  it('query strings do not break routing', async () => {
    const { res } = await call('/dsm/api/status?probe=1')
    expect(res.statusCode).toBe(200)
  })
})
