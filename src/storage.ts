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
import type { Context, DsmKv } from './context-types.ts'
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
  // Defaulted (not required) on purpose: the domain OPEN strictly parses
  // every stored row, so a required field here would reject prefs rows
  // persisted by builds before this field existed (and the store would
  // silently degrade to memory-only). .default() fills the missing key at
  // parse time, so old rows come out enabled.
  composerChipEnabled: z.boolean().default(true),
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
  // Optional both directions: rows persisted before these fields existed
  // parse unchanged, and the chart treats absent as zero.
  otherCacheHit: z.number().optional(),
  otherCacheMiss: z.number().optional(),
  otherResponse: z.number().optional(),
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

// Resilience declaration (dsh 0.1.2-rc.1 baseline; both fields are native
// to the rc.1 DomainSpec — no version workaround needed):
// - layout 'per-record': one version-stamped document per record, so the json
//   backend (the base bundle's default route) exposes `backupRecord`. Its
//   legacy bootstrap copies every DECLARED table's records as-is into file
//   names on first open — which is why the usage table became `cache` with
//   path-safe keys: the historical `usage:YYYY-M` colon keys are not
//   path-safe (per-record rejects them at write, and migrating them would
//   break the bootstrap on Windows). The undeclared old table is skipped,
//   trading one re-fetchable usage cache for a safe migration; prefs survive
//   intact. The untouched legacy file keeps working, so a version rollback
//   loses nothing written before the migration.
// - invalidRecords 'backup-and-skip': a stored row that fails its zod schema
//   is moved aside (`.bak.<stamp>`) and skipped instead of rejecting the
//   WHOLE open — right for disposable cache/prefs data, which would
//   otherwise degrade the entire store to memory mode over one corrupt row.
export const monitorDomain = defineDomain({
  name: 'deepseek_monitor',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    /** Single row (key `prefs`): user preferences. */
    prefs: domainTable<'prefs', MonitorPrefs>(prefsSchema),
    /** Data cache: the balance snapshot under key `balance` and per-month
     *  usage results under `usage-YYYY-M` (path-safe). One table on
     *  purpose. */
    cache: domainTable<string, UsageResult | BalanceSnapshot>(usageResultSchema.or(balanceSchema)),
  },
})

/** Cache-row key for a usage month: `usage-2026-8` (path-safe — the
 *  historical `usage:2026-8` colon form would reject at write under the
 *  per-record layout). */
function usageKey(year: number, month: number): string {
  return `usage-${year}-${month}`
}

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

function buildOver(tables: { prefs: () => DsmKv, cache: () => DsmKv }): MonitorStore {
  const readPrefs = (): MonitorPrefs => {
    const stored = tables.prefs().get('prefs') as Partial<MonitorPrefs> | undefined
    // The schema defaults composerChipEnabled on legacy rows at parse time,
    // so a plain spread can never clobber it with undefined.
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
      return (tables.cache().get(usageKey(year, month)) as UsageResult | undefined) ?? null
    },
    async setUsage(result) {
      await tables.cache().put(usageKey(result.year, result.month), result)
    },
    async clearCache() {
      const cache = tables.cache()
      // Snapshot iteration (the domain table's keys() is a snapshot too), so
      // deleting while iterating cannot skip rows.
      for (const key of [...cache.keys()]) await cache.delete(key)
    },
  }
}

interface MemoryTables {
  prefs: () => DsmKv
  cache: () => DsmKv
  /** The raw maps, so a late domain swap can MIGRATE boot-window writes. */
  maps: { prefs: Map<string, unknown>, cache: Map<string, unknown> }
}

function memoryTables(): MemoryTables {
  const maps = {
    prefs: new Map<string, unknown>(),
    cache: new Map<string, unknown>(),
  }
  const wrap = (map: Map<string, unknown>): DsmKv => ({
    get: key => map.get(key),
    // Snapshot iterator, matching the domain table's keys().
    keys: () => [...map.keys()][Symbol.iterator](),
    put: async (key, value) => { map.set(key, value) },
    delete: async key => map.delete(key),
  })
  return { prefs: () => wrap(maps.prefs), cache: () => wrap(maps.cache), maps }
}

/** The process-level store accessor (singleton; see the file contract). */
export function sharedStore(
  storageDomain: Context['storageDomain'] | undefined,
  onDegrade?: (message: string) => void,
): MonitorStore {
  const g = globalThis as unknown as { [STORE_KEY]?: MonitorStore }
  const existing = g[STORE_KEY]
  if (existing !== undefined) return existing

  // Start in memory so reads/writes work from tick zero.
  const mem = memoryTables()
  let active: MonitorStore = buildOver(mem)
  // Serializes the cache-row writes across the memory → domain swap: a
  // forced panel fetch and a clearCache racing each other would otherwise
  // interleave row puts/deletes across the swap boundary. Chaining here
  // (instead of inside buildOver) keeps one queue alive across the swap,
  // which rebuilds its tables. Same shape as dsh-usage-statistics-panel's
  // markChain.
  let indexChain: Promise<void> = Promise.resolve()
  const serialized = (task: () => Promise<void>): Promise<void> => {
    const write = indexChain.then(task)
    indexChain = write.then(
      () => undefined,
      () => undefined,
    )
    return write
  }
  const store: MonitorStore = {
    getPrefs: () => active.getPrefs(),
    setPrefs: patch => active.setPrefs(patch),
    getBalance: () => active.getBalance(),
    setBalance: snapshot => active.setBalance(snapshot),
    getUsage: (year, month) => active.getUsage(year, month),
    setUsage: result => serialized(() => active.setUsage(result)),
    clearCache: () => serialized(() => active.clearCache()),
  }

  if (storageDomain !== undefined) {
    // The swap must CARRY OVER boot-window writes: the first refresh tick
    // races the async open, and dropping what landed in memory would lose a
    // balance snapshot or a saved preference until some later cycle rewrote
    // it. Rows are copied into the real tables BEFORE active flips; a write
    // landing mid-copy after its key was taken still misses — an accepted
    // sub-millisecond window, documented rather than pretended away.
    void storageDomain
      .open(monitorDomain)
      .then(async (domain) => {
        const prefsTable = domain.table('prefs') as DsmKv
        const cacheTable = domain.table('cache') as DsmKv
        for (const [key, value] of mem.maps.prefs) await prefsTable.put(key, value)
        for (const [key, value] of mem.maps.cache) await cacheTable.put(key, value)
        return buildOver({ prefs: () => prefsTable, cache: () => cacheTable })
      })
      .then((real) => { active = real })
      .catch((cause: unknown) => {
        // Degraded mode stays in memory. Surface the reason through the
        // optional callback (host log) — silence by default keeps headless
        // and unit-test runs clean.
        onDegrade?.(`storage domain open failed, staying in memory: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
  }

  g[STORE_KEY] = store
  return store
}

/** Reset the process-level store cache (test seam only). */
export function _resetSharedStoreForTests(): void {
  delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY]
}
