/**
 * The /dsm/api route table: identity/status (key+token state, cached balance,
 * low-balance flag), forced balance refresh, monthly usage, platform-token
 * set/clear, preferences, cache actions, and per-session model route — all
 * behind the browser-trust fence.
 */

import type { Context, DsmHttpRequest, DsmHttpResponse, DsmWebRoute } from './context-types.ts'
import type { BalanceSnapshot, ModelRouteInfo, MonitorPrefs, MonitorStatus, UsageResult } from './wire.ts'
import { DEFAULT_PREFS, DsmError, readJsonBody, writeError, writeJson } from './wire.ts'
import { createTrustFence, type TrustFence } from './trust-fence.ts'

export const PLUGIN_VERSION = '0.1.1'

/** Endpoints the current build serves (the UI's capability probe). */
const ENDPOINTS = [
  'GET /dsm/api/status',
  'POST /dsm/api/route',
  'POST /dsm/api/balance',
  'POST /dsm/api/usage',
  'POST /dsm/api/token',
  'GET|POST /dsm/api/prefs',
  'POST /dsm/api/cache',
] as const

/** Host-side services wired by index.ts. */
export interface MonitorServices {
  /** Route lookup: live map + lazy session seed. */
  routes: { get(sessionId: string): ModelRouteInfo | undefined }
  balance: { get(force: boolean): Promise<BalanceSnapshot>, peek(): BalanceSnapshot | null, lastError(): string }
  usage: { get(year: number, month: number, force: boolean): Promise<UsageResult> }
  platformToken: {
    verifyAndStore(token: string): Promise<void>
    clear(): Promise<void>
    describe(): Promise<{ configured: boolean, writable?: boolean }>
  }
  /** The reused API key's configured state (never its value). */
  apiKeyState(): Promise<{ configured: boolean }>
  prefs: { get(): MonitorPrefs, update(patch: Partial<MonitorPrefs>): Promise<MonitorPrefs> }
  cache: { clear(): Promise<void>, refreshAll(): Promise<void> }
  lowBalance(): boolean
  refresherError(): string
}

const PREF_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_PREFS))

/** Validate an incoming prefs patch: only known keys, sane ranges. */
function sanitizePrefsPatch(patch: Partial<MonitorPrefs>): Partial<MonitorPrefs> {
  const out: Partial<MonitorPrefs> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!PREF_KEYS.has(key)) continue
    if (key === 'autoRefreshEnabled' || key === 'lowBalanceNotify' || key === 'composerChipEnabled') {
      if (typeof value === 'boolean') (out as Record<string, unknown>)[key] = value
      continue
    }
    if (key === 'refreshIntervalSeconds') {
      if (typeof value === 'number' && Number.isFinite(value)) (out as Record<string, unknown>)[key] = Math.max(60, Math.round(value))
      continue
    }
    if (key === 'lowBalanceThreshold') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) (out as Record<string, unknown>)[key] = value
      continue
    }
  }
  return out
}

/**
 * Build the single fenced prefix route serving /dsm/api. The host mounts it
 * via `ctx.webServer.register` (ONE WebRoute, not an array).
 */
export function buildMonitorRoute(ctx: Context, version: string, services: MonitorServices): DsmWebRoute {
  // The trusted-host list comes live from the web runtime when bound; fall
  // back to loopback-only when absent (headless).
  const trustedHosts = (): string[] => {
    const rt = (ctx as unknown as { webRuntime?: { trustedHosts?: string[] } }).webRuntime
    return rt?.trustedHosts ?? []
  }
  const fence: TrustFence = createTrustFence(trustedHosts)
  const handler = async (req: DsmHttpRequest, res: DsmHttpResponse): Promise<void> => {
    if (!fence.isTrusted(req)) {
      writeJson(res, { ok: false, error: { code: 'forbidden', message: 'untrusted host' } }, 403)
      return
    }
    const rawUrl = req.url ?? ''
    const method = req.method ?? 'GET'
    // Exact-name dispatch inside the mounted API space. The webserver hands
    // us the full path ('/dsm/api/status'); the bare remainder ('/status') is
    // tolerated for mount-shape independence. Query/hash are stripped so
    // '/dsm/api/status?x=1' still routes, and a nested '/dsm/api/x/status'
    // can no longer fall into the status branch the way suffix matching
    // allowed.
    const path = rawUrl.split(/[?#]/, 1)[0] ?? ''
    const routePath = path.startsWith('/dsm/api/') ? path.slice('/dsm/api'.length) : path
    try {
      if ((method === 'GET' || method === 'POST') && routePath === '/status') {
        if (method === 'POST') await readJsonBody(req)
        const [apiKey, platformToken] = await Promise.all([
          services.apiKeyState(),
          services.platformToken.describe(),
        ])
        const prefs = services.prefs.get()
        const status: MonitorStatus & { lastError?: string } = {
          plugin: 'dsh-deepseek-monitor',
          version,
          endpoints: [...ENDPOINTS],
          apiKey,
          platformToken,
          balance: services.balance.peek(),
          ...(services.lowBalance() ? { lowBalance: true } : {}),
          lowBalanceThreshold: prefs.lowBalanceThreshold,
          // Absent on old persisted rows = on; the client treats missing as
          // enabled so an upgrade never silently hides the chip.
          composerChipEnabled: prefs.composerChipEnabled !== false,
          ...(services.refresherError() === '' ? {} : { lastError: services.refresherError() }),
        }
        writeJson(res, { ok: true, value: status })
        return
      }
      if (method === 'POST' && routePath === '/balance') {
        const body = await readJsonBody(req) as { force?: unknown }
        // Cache-first default: only an EXPLICIT force:true hits the upstream
        // API, so a client that forgets the flag can never turn into a poller
        // that bypasses the TTL. The UI always sends the flag explicitly.
        const force = body?.force === true
        writeJson(res, { ok: true, value: await services.balance.get(force) })
        return
      }
      if (method === 'POST' && routePath === '/usage') {
        const body = await readJsonBody(req) as { year?: unknown, month?: unknown, force?: unknown }
        const now = new Date()
        const year = typeof body?.year === 'number' ? body.year : now.getFullYear()
        const month = typeof body?.month === 'number' ? body.month : now.getMonth() + 1
        if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
          throw new DsmError(400, 'usage needs a valid year (2020-2100) and month (1-12)')
        }
        writeJson(res, { ok: true, value: await services.usage.get(year, month, body?.force === true) })
        return
      }
      if (method === 'POST' && routePath === '/token') {
        const body = await readJsonBody(req) as { action?: unknown, value?: unknown }
        if (body?.action === 'set') {
          if (typeof body.value !== 'string') throw new DsmError(400, 'token set needs a string value')
          await services.platformToken.verifyAndStore(body.value)
          writeJson(res, { ok: true, value: await services.platformToken.describe() })
          return
        }
        if (body?.action === 'clear') {
          await services.platformToken.clear()
          writeJson(res, { ok: true, value: await services.platformToken.describe() })
          return
        }
        throw new DsmError(400, "token action must be 'set' or 'clear'")
      }
      if (method === 'GET' && routePath === '/prefs') {
        writeJson(res, { ok: true, value: services.prefs.get() })
        return
      }
      if (method === 'POST' && routePath === '/prefs') {
        const body = await readJsonBody(req) as Record<string, unknown>
        writeJson(res, { ok: true, value: await services.prefs.update(sanitizePrefsPatch(body ?? {})) })
        return
      }
      if (method === 'POST' && routePath === '/cache') {
        const body = await readJsonBody(req) as { action?: unknown }
        if (body?.action === 'clear') {
          await services.cache.clear()
          writeJson(res, { ok: true, value: { cleared: true } })
          return
        }
        if (body?.action === 'refresh') {
          await services.cache.refreshAll()
          writeJson(res, { ok: true, value: { refreshed: true } })
          return
        }
        throw new DsmError(400, "cache action must be 'clear' or 'refresh'")
      }
      if (method === 'POST' && routePath === '/route') {
        const body = await readJsonBody(req) as { sessionId?: unknown }
        if (typeof body?.sessionId !== 'string' || body.sessionId === '') {
          throw new DsmError(400, 'route needs a non-empty sessionId')
        }
        writeJson(res, { ok: true, value: { route: services.routes.get(body.sessionId) ?? null } })
        return
      }
      if (method === 'POST') {
        // Body must be consumed before answering so keep-alive stays framed.
        await readJsonBody(req)
      }
      throw new DsmError(404, `unknown endpoint ${method} ${rawUrl}`)
    } catch (err) {
      const logger = (ctx as unknown as { logger?: { warn(message: unknown): void } }).logger
      if (!(err instanceof DsmError)) logger?.warn(err instanceof Error ? err : new Error(String(err)))
      writeError(res, err)
    }
  }
  return { kind: 'prefix', path: '/dsm/api', handler }
}
