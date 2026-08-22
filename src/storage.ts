/**
 * Plugin-owned persistence on the storage-domain hub: user preferences and
 * the data cache (balance snapshot, per-month usage results) live in the
 * `deepseek_monitor` domain. `storageDomain.open()` allows one open per
 * process name and offers no close, so the handle is a PROCESS-level
 * singleton keyed on globalThis — a hot reload would otherwise hit
 * "domain already open" and fail the whole plugin tree (the exact failure
 * dsh-usage-statistics-panel documented for its store).
 *
 * Availability strategy: the accessor returns immediately backed by an
 * in-memory table, then swaps to the real domain when its async open lands
 * (open failures — headless, degraded disk — simply stay in memory). Reads
 * before the swap see in-memory state only; every write after the swap lands
 * durably.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { Context, DsmDomain, DsmKv } from './context-types.ts'
import { DEFAULT_PREFS, type BalanceSnapshot, type MonitorPrefs, type UsageResult } from './wire.ts'

// ── Domain definition ──────────────────────────────────────────────────────
// Every table MUST be declared here with a value schema — opening the domain
// with an empty tables spec and touching undeclared names is what crashed the
// host (fixed 2026-08-22; see the file-contract note below).

const prefsSchema = z.object({
  autoRefreshEnabled: z.boolean(),
  refreshIntervalSeconds: z.number(),
  lowBalanceNotify: z.boolean(),
  lowBalanceThreshold: z.number(),
})

const balanceSchema = z.object({
  isAvailable: z.boolean(),
  currency: z.string(),
  totalBalance: z.string(),
  grantedBalance: z.string(),
  toppedUpBalance: z.string(),
  fetchedAt: z.number(),
})

const usageModelSchema = z.object({
  key: z.string(),
  name: z.string(),
  totalTokens: z.number(),
  requestCount: z.number(),
  cacheHitTokens: z.number(),
  cacheMissTokens: z.number(),
  responseTokens: z.number(),
  cost: z.number(),
})

const usageDaySchema = z.object({
  date: z.string(),
  flashTokens: z.number(),
  flashCacheHit: z.number(),
  flashCacheMiss: z.number(),
  flashResponse: z.number(),
  proTokens: z.number(),
  proCacheHit: z.number(),
  proCacheMiss: z.number(),
  proResponse: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
})

const usageResultSchema = z.object({
  year: z.number(),
  month: z.number(),
  models: z.array(usageModelSchema),
  days: z.array(usageDaySchema),
  monthCost: z.number(),
  fetchedAt: z.number(),
})

export const monitorDomain = defineDomain({
  name: 'deepseek_monitor',
  version: 1,
  tables: {
    /** Single row (key `prefs`): user preferences. */
    prefs: domainTable<'prefs', MonitorPrefs>(prefsSchema),
    /** Single row (key `balance`): last known balance snapshot. */
    balance: domainTable<'balance', BalanceSnapshot>(balanceSchema),
    /** Per-month rows (key `YYYY-M`). */
    usage: domainTable<string, UsageResult>(usageResultSchema),
    /** Single row (key `index`): stored usage-month keys. */
    index: domainTable<'index', Record<string, boolean>>(z.record(z.string(), z.boolean())),
  },
})

export interface MonitorStore {
  getPrefs(): MonitorPrefs
  setPrefs(patch: Partial<MonitorPrefs>): Promise<MonitorPrefs>
  getBalance(): BalanceSnapshot | null
  setBalance(snapshot: BalanceSnapshot | null): Promise<void>
  getUsage(year: number, month: number): UsageResult | null
  setUsage(result: UsageResult): Promise<void>
  clearCache(): Promise<void>
}

const STORE_KEY = '__dshDeepSeekMonitorStore'

function buildOver(tables: { prefs: () => DsmKv, cache: () => DsmKv, index: () => DsmKv }): MonitorStore {
  const readPrefs = (): MonitorPrefs => {
    const stored = tables.prefs().get('prefs') as Partial<MonitorPrefs> | undefined
    return stored === null || stored === undefined ? { ...DEFAULT_PREFS } : { ...DEFAULT_PREFS, ...stored }
  }
  return {
    getPrefs: readPrefs,
    async setPrefs(patch) {
      const next = { ...readPrefs(), ...patch }
      await tables.prefs().put('prefs', next)
      return next
    },
    getBalance(): BalanceSnapshot | null {
      return (tables.cache().get('balance') as BalanceSnapshot | undefined) ?? null
    },
    async setBalance(snapshot) {
      const cache = tables.cache()
      if (snapshot === null) await cache.delete('balance')
      else await cache.put('balance', snapshot)
    },
    getUsage(year: number, month: number): UsageResult | null {
      return (tables.cache().get(`usage:${year}-${month}`) as UsageResult | undefined) ?? null
    },
    async setUsage(result) {
      const cache = tables.cache()
      const key = `usage:${result.year}-${result.month}`
      await cache.put(key, result)
      const index = (tables.index().get('index') as Record<string, true> | undefined) ?? {}
      index[key] = true
      await tables.index().put('index', index)
    },
    async clearCache() {
      const cache = tables.cache()
      const index = (tables.index().get('index') as Record<string, true> | undefined) ?? {}
      for (const key of Object.keys(index)) await cache.delete(key)
      await tables.index().put('index', {})
      await cache.delete('balance')
    },
  }
}

function memoryTables(): { prefs: () => DsmKv, cache: () => DsmKv, index: () => DsmKv } {
  const prefsMap = new Map<string, unknown>()
  const cacheMap = new Map<string, unknown>()
  const indexMap = new Map<string, unknown>()
  const wrap = (map: Map<string, unknown>): DsmKv => ({
    get: key => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    delete: async key => map.delete(key),
  })
  return { prefs: () => wrap(prefsMap), cache: () => wrap(cacheMap), index: () => wrap(indexMap) }
}

/** The process-level store accessor (singleton; see the file contract). */
export function sharedStore(storageDomain: Context['storageDomain'] | undefined): MonitorStore {
  const g = globalThis as unknown as { [STORE_KEY]?: MonitorStore }
  const existing = g[STORE_KEY]
  if (existing !== undefined) return existing

  // Start in memory so reads/writes work from tick zero.
  let active: MonitorStore = buildOver(memoryTables())
  const store: MonitorStore = {
    getPrefs: () => active.getPrefs(),
    setPrefs: patch => active.setPrefs(patch),
    getBalance: () => active.getBalance(),
    setBalance: snapshot => active.setBalance(snapshot),
    getUsage: (year, month) => active.getUsage(year, month),
    setUsage: result => active.setUsage(result),
    clearCache: () => active.clearCache(),
  }

  if (storageDomain !== undefined) {
    void storageDomain
      .open(monitorDomain as never)
      .then(domain => buildOver({
        prefs: () => domain.table('prefs') as DsmKv,
        cache: () => domain.table('usage') as DsmKv,
        index: () => domain.table('index') as DsmKv,
      }))
      .then((real) => { active = real })
      .catch(() => { /* degraded mode stays in memory */ })
  }

  g[STORE_KEY] = store
  return store
}
