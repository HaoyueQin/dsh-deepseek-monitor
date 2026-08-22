/**
 * dsh-deepseek-monitor host half: the full monitoring backend behind the
 * fenced /dsm/api routes —
 * ① balance via the official API, reusing the harness-configured DeepSeek API
 *    key (credentials seam, per-operation resolve);
 * ② monthly platform usage (amount + cost) with the stored platform token;
 * ③ preferences + data cache persisted in the plugin storage domain;
 * ④ the settings-driven refresher (the only scheduled upstream caller);
 * ⑤ per-session model-route tracking for the composer band gate.
 */

import type { Context } from './context-types.ts'
import { createBalanceService } from './balance.ts'
import { DEFAULT_KEY_REF } from './balance.ts'
import { createPlatformTokenService } from './platform-token.ts'
import { createUsageService } from './usage.ts'
import { createRefresher } from './refresher.ts'
import { sharedStore } from './storage.ts'
import { buildMonitorRoute, PLUGIN_VERSION } from './routes.ts'
import type { MonitorPrefs } from './wire.ts'

export const name = 'dsh-deepseek-monitor'

/** Services required before mounting. */
export const inject = ['webServer', 'sessions', 'credentials', 'storageDomain']

export interface DeepSeekMonitorConfig {
  /** Override the advertised version (defaults to the built constant). */
  version?: string
  /** Override the reused API-key reference (default DEEPSEEK_API_KEY). */
  keyRef?: string
}

export function apply(ctx: Context, config: DeepSeekMonitorConfig = {}): void {
  const store = sharedStore(ctx.storageDomain)
  const balance = createBalanceService({ credentials: ctx.credentials, ...(config.keyRef === undefined ? {} : { keyRef: config.keyRef }) })
  const usage = createUsageService({ credentials: ctx.credentials })
  const platformToken = createPlatformTokenService({ credentials: ctx.credentials })

  // Balance reads persist through the store so status/chips survive restarts.
  const balanceWithStore = {
    get: async (force: boolean) => {
      const snapshot = await balance.get(force)
      await store.setBalance(snapshot)
      return snapshot
    },
    peek: (): ReturnType<typeof balance.peek> => store.getBalance() ?? balance.peek(),
    lastError: balance.lastError,
  }

  // Cache-first usage read; `force` bypasses the cache.
  const usageCached = {
    get: async (year: number, month: number, force: boolean) => {
      if (!force) {
        const cached = store.getUsage(year, month)
        if (cached !== null) return cached
      }
      const result = await usage.fetch(year, month)
      await store.setUsage(result)
      return result
    },
  }

  // Last known provider/model per session id. `request/context` logs on
  // route changes only; misses seed lazily from sessions' requestContext fold.
  const routes = new Map<string, { provider: string, model: string }>()
  ctx.effect(() => {
    const off = ctx.on('session/event', (sessionId, event) => {
      if (event.type !== 'request/context') return
      const data = event.data as { provider?: unknown, model?: unknown } | undefined
      if (data !== null && typeof data === 'object' && typeof data.provider === 'string' && typeof data.model === 'string') {
        routes.set(String(sessionId), { provider: data.provider, model: data.model })
      }
    })
    return off
  }, 'dsh-deepseek-monitor: session route tracking')

  let tokenConfigured = false
  const tokenFlag = (): Promise<boolean> =>
    platformToken.describe().then((info) => { tokenConfigured = info.configured; return info.configured })

  const refresher = createRefresher({
    store,
    balance: balanceWithStore,
    usage: { fetch: (year, month) => usage.fetch(year, month) },
    hasPlatformToken: tokenFlag,
  })

  const lowBalance = (): boolean => {
    const prefs = store.getPrefs()
    if (!prefs.lowBalanceNotify) return false
    const snapshot = balanceWithStore.peek()
    return snapshot !== null && Number.parseFloat(snapshot.totalBalance) <= prefs.lowBalanceThreshold
  }

  const services = {
    routes: {
      get(sessionId: string): { provider: string, model: string } | undefined {
        const known = routes.get(sessionId)
        if (known !== undefined) return known
        const folded = ctx.sessions?.get?.(sessionId)?.requestContext?.()
        if (folded !== null && typeof folded === 'object' && typeof folded.provider === 'string' && typeof folded.model === 'string') {
          const seeded = { provider: folded.provider, model: folded.model }
          routes.set(sessionId, seeded)
          return seeded
        }
        return undefined
      },
    },
    apiKeyState: async (): Promise<{ configured: boolean }> => {
      const info = await ctx.credentials.describe(config.keyRef ?? DEFAULT_KEY_REF)
      return { configured: info.configured }
    },
    platformToken,
    balance: balanceWithStore,
    usage: usageCached,
    prefs: {
      get: (): MonitorPrefs => store.getPrefs(),
      update: async (patch: Partial<MonitorPrefs>): Promise<MonitorPrefs> => {
        const next = await store.setPrefs(patch)
        // Restart the schedule chain so a changed interval/enabled applies live.
        refresher.dispose()
        refresher.start()
        return next
      },
    },
    cache: {
      clear: async () => { await store.clearCache() },
      refreshAll: async () => { await refresher.refreshNow() },
    },
    lowBalance,
    refresherError: refresher.lastError,
  }

  ctx.effect(() => {
    // A rejected flag must never surface as an unhandled rejection — that is
    // the exact failure mode that took the host down (exit 1, 2026-08-22).
    void tokenFlag()
      .then(() => { refresher.start() })
      .catch((cause: unknown) => {
        const logger = (ctx as unknown as { logger?: { warn(message: unknown): void } }).logger
        logger?.warn(cause instanceof Error ? cause : new Error(String(cause)))
        refresher.start()
      })
    const dispose = ctx.webServer.register(buildMonitorRoute(ctx, config.version ?? PLUGIN_VERSION, services) as never)
    return () => {
      refresher.dispose()
      dispose()
    }
  }, 'dsh-deepseek-monitor: routes + refresher')
}

export { PLUGIN_VERSION } from './routes.ts'
export { PLATFORM_TOKEN_REF } from './platform-token.ts'
export { DEFAULT_KEY_REF } from './balance.ts'
export type { MonitorStatus, ModelRouteInfo, BalanceSnapshot, UsageResult, UsageModelSummary, UsageDaySummary, MonitorPrefs } from './wire.ts'
