/**
 * The settings-driven refresher: the ONLY upstream caller on a schedule. Each
 * tick re-reads preferences (the interval is live-tunable), force-refreshes
 * the balance, refreshes the current month's usage when a platform token is
 * configured, persists both into the storage domain, and recomputes the
 * low-balance flag. Errors are recorded, never thrown — the next tick
 * retries; a 429 backs the affected source off for one cycle.
 */

import type { BalanceSnapshot, UsageResult } from './wire.ts'
import { DsmError } from './wire.ts'
import type { MonitorStore } from './storage.ts'

export interface RefresherDeps {
  store: MonitorStore
  balance: { get(force: boolean): Promise<BalanceSnapshot> }
  usage: { fetch(year: number, month: number): Promise<UsageResult> }
  hasPlatformToken(): Promise<boolean>
}

const MIN_INTERVAL_SECONDS = 60

export function createRefresher(deps: RefresherDeps): {
  start(): void
  dispose(): void
  /** One immediate full refresh (重载缓存 action). */
  refreshNow(): Promise<void>
  lastError(): string
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let running = false
  let error = ''
  /** Sources backed off until this timestamp after a 429. */
  let backoffUntil = 0

  const refreshOnce = async (): Promise<void> => {
    if (running) return
    running = true
    // The error slot reflects THIS tick only: clearing it here lets a
    // recovered source drop its old failure from /status and keeps
    // refreshNow() honest (a successful run must not re-throw the previous
    // tick's message).
    error = ''
    try {
      const prefs = deps.store.getPrefs()
      const now = Date.now()
      if (now >= backoffUntil) {
        try {
          const snapshot = await deps.balance.get(true)
          await deps.store.setBalance(snapshot)
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
          if (cause instanceof DsmError && cause.status === 429) backoffUntil = Date.now() + prefs.refreshIntervalSeconds * 1000
        }
      }
      if (await deps.hasPlatformToken() && Date.now() >= backoffUntil) {
        try {
          const now2 = new Date()
          const result = await deps.usage.fetch(now2.getFullYear(), now2.getMonth() + 1)
          await deps.store.setUsage(result)
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
          if (cause instanceof DsmError && cause.status === 429) backoffUntil = Date.now() + prefs.refreshIntervalSeconds * 1000
        }
      }
    } catch (cause) {
      // ABSOLUTE last resort: nothing from this tick may ever escape as an
      // unhandled rejection — an escaping rejection here is what killed the
      // host process (exit code 1, fixed 2026-08-22).
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      running = false
    }
  }

  /** Timer callback wrapper: a throw inside the chain must stay contained. */
  const tick = (): void => {
    try {
      void refreshOnce().finally(scheduleNext)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      scheduleNext()
    }
  }

  const scheduleNext = (): void => {
    if (disposed) return
    let prefs
    try {
      prefs = deps.store.getPrefs()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      return
    }
    if (!prefs.autoRefreshEnabled) return
    const intervalMs = Math.max(MIN_INTERVAL_SECONDS, prefs.refreshIntervalSeconds) * 1000
    timer = setTimeout(tick, intervalMs)
  }

  return {
    start(): void {
      // Revivable: prefs.update() restarts the chain with dispose()+start(),
      // so start() must clear the retired flag — a one-shot dispose would
      // otherwise kill auto-refresh for the rest of the fiber's life.
      disposed = false
      scheduleNext()
    },
    dispose(): void {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    async refreshNow(): Promise<void> {
      await refreshOnce()
      if (error !== '' ) throw new DsmError(502, error)
    },
    lastError(): string {
      return error
    },
  }
}
