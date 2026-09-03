import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetSharedStoreForTests, monitorDomain, sharedStore } from '../src/storage.ts'
import type { BalanceSnapshot, UsageResult } from '../src/wire.ts'

const snap = (): BalanceSnapshot => ({
  isAvailable: true,
  currency: 'USD',
  totalBalance: '5.00',
  grantedBalance: '1.00',
  toppedUpBalance: '4.00',
  fetchedAt: 42,
})

afterEach(() => { _resetSharedStoreForTests() })

describe('memory fallback (no storageDomain)', () => {
  it('round-trips prefs and the balance snapshot', async () => {
    const store = sharedStore(undefined)
    await store.setPrefs({ refreshIntervalSeconds: 300 })
    expect(store.getPrefs().refreshIntervalSeconds).toBe(300)
    await store.setBalance(snap())
    expect(store.getBalance()?.totalBalance).toBe('5.00')
    await store.setBalance(null)
    expect(store.getBalance()).toBeNull()
  })

  it('merges patches over defaults instead of replacing them', async () => {
    const store = sharedStore(undefined)
    await store.setPrefs({ lowBalanceNotify: true })
    const prefs = store.getPrefs()
    expect(prefs.lowBalanceNotify).toBe(true)
    expect(prefs.refreshIntervalSeconds).toBe(60)
  })

  it('round-trips the composer-chip switch and defaults it to on', async () => {
    const store = sharedStore(undefined)
    expect(store.getPrefs().composerChipEnabled).toBe(true)
    await store.setPrefs({ composerChipEnabled: false })
    expect(store.getPrefs().composerChipEnabled).toBe(false)
    // A later patch on another key must not resurrect the switch.
    await store.setPrefs({ lowBalanceNotify: true })
    expect(store.getPrefs().composerChipEnabled).toBe(false)
  })
})

describe('domain swap migration', () => {
  it('carries boot-window memory writes into the real tables', async () => {
    let resolveOpen!: () => void
    const opened = new Promise<void>(resolve => { resolveOpen = resolve })
    const backing = {
      prefs: new Map<string, unknown>(),
      cache: new Map<string, unknown>(),
    }
    const kv = (m: Map<string, unknown>) => ({
      get: (k: string) => m.get(k),
      keys: () => [...m.keys()][Symbol.iterator](),
      put: async (k: string, v: unknown) => { m.set(k, v) },
      delete: async (k: string) => m.delete(k),
    })
    const domainStub = {
      open: () => opened.then(() => ({
        table: (name: string) => kv(backing[name === 'prefs' ? 'prefs' : 'cache']),
      })),
    }

    // Writes land in MEMORY while the open is still pending.
    const store = sharedStore(domainStub as never)
    await store.setPrefs({ refreshIntervalSeconds: 120 })
    await store.setBalance(snap())

    resolveOpen()
    // Flush the open -> migrate -> swap chain.
    await vi.waitFor(() => {
      expect(backing.prefs.get('prefs')).toBeTruthy()
      expect(backing.cache.get('balance')).toBeTruthy()
    })

    // Reads now come from the REAL tables (a memory-only row would vanish).
    expect(backing.cache.get('balance')).toMatchObject({ totalBalance: '5.00' })
    expect(store.getPrefs().refreshIntervalSeconds).toBe(120)
    expect(store.getBalance()?.currency).toBe('USD')
    // The cache key is path-safe (`usage-2026-8`): the per-record layout
    // turns keys into file names, and the historical colon form would
    // reject at write there.
    const month = (y: number, m: number): UsageResult => ({ year: y, month: m, models: [], days: [], monthCost: 0, fetchedAt: 1 })
    await store.setUsage(month(2026, 8))
    expect(backing.cache.get('usage-2026-8')).toMatchObject({ year: 2026 })
  })

  it('reads a legacy prefs row (no composerChipEnabled) as enabled after the swap', async () => {
    const backing = {
      prefs: new Map<string, unknown>(),
      cache: new Map<string, unknown>(),
    }
    // A row persisted by a build before the switch existed: no
    // composerChipEnabled key. refreshIntervalSeconds=300 distinguishes the
    // REAL table (read after the swap) from the boot-window memory defaults.
    backing.prefs.set('prefs', {
      autoRefreshEnabled: true,
      refreshIntervalSeconds: 300,
      lowBalanceNotify: false,
      lowBalanceThreshold: 10,
    })
    const kv = (m: Map<string, unknown>) => ({
      get: (k: string) => m.get(k),
      keys: () => [...m.keys()][Symbol.iterator](),
      put: async (k: string, v: unknown) => { m.set(k, v) },
      delete: async (k: string) => m.delete(k),
    })
    const domainStub = {
      open: async () => ({
        table: (name: string) => kv(name === 'prefs' ? backing.prefs : backing.cache),
      }),
    }
    const store = sharedStore(domainStub as never)
    await vi.waitFor(() => { expect(store.getPrefs().refreshIntervalSeconds).toBe(300) })
    // The missing optional field must NOT clobber the default to undefined.
    expect(store.getPrefs().composerChipEnabled).toBe(true)
  })
})

describe('degrade callback', () => {
  it('reports a domain open failure and keeps serving from memory', async () => {
    const onDegrade = vi.fn()
    const failing = { open: async () => { throw new Error('backend down') } }
    const store = sharedStore(failing as never, onDegrade)
    await store.setPrefs({ refreshIntervalSeconds: 90 })
    await vi.waitFor(() => { expect(onDegrade).toHaveBeenCalledTimes(1) })
    expect(String(onDegrade.mock.calls[0]?.[0])).toContain('backend down')
    // Memory mode keeps serving after the degrade.
    await store.setBalance(snap())
    expect(store.getBalance()?.totalBalance).toBe('5.00')
  })
})

describe('cache write serialization', () => {
  it('never loses a row when concurrent writes and clearCache interleave', async () => {
    _resetSharedStoreForTests()
    const backing = {
      prefs: new Map<string, unknown>(),
      cache: new Map<string, unknown>(),
    }
    // Async kv with a delayed write: without serialization a clearCache racing
    // a setUsage could interleave its deletes/puts across the swap boundary
    // and leave rows behind.
    const kv = (m: Map<string, unknown>) => ({
      get: (k: string) => m.get(k),
      keys: () => [...m.keys()][Symbol.iterator](),
      put: async (k: string, v: unknown) => { await new Promise(resolve => setTimeout(resolve, 0)); m.set(k, v) },
      delete: async (k: string) => { await new Promise(resolve => setTimeout(resolve, 0)); m.delete(k) },
    })
    let resolveOpen!: () => void
    const opened = new Promise<void>(resolve => { resolveOpen = resolve })
    const domainStub = {
      open: () => opened.then(() => ({
        table: (name: string) => kv(name === 'prefs' ? backing.prefs : backing.cache),
      })),
    }
    const store = sharedStore(domainStub as never)
    // Swap to the real tables BEFORE the concurrent writes so the race runs
    // on the async kv above.
    resolveOpen()
    await store.setPrefs({ refreshIntervalSeconds: 120 })
    await vi.waitFor(() => { expect(backing.prefs.get('prefs')).toBeTruthy() })
    await new Promise(resolve => setTimeout(resolve, 0))

    const month = (y: number, m: number): UsageResult => ({ year: y, month: m, models: [], days: [], monthCost: 0, fetchedAt: 1 })
    await Promise.all([store.setUsage(month(2026, 1)), store.setUsage(month(2026, 2))])
    await store.clearCache()
    // clearCache deletes every cached row; a lost key would leave its row
    // behind and keep serving stale data.
    expect(store.getUsage(2026, 1)).toBeNull()
    expect(store.getUsage(2026, 2)).toBeNull()
  })
})

describe('domain spec declaration', () => {
  it('declares the per-record + backup-and-skip resilience of the rc.1 DomainSpec', () => {
    // Module load already ran defineDomain on the devDeps kernel: both fields
    // are native, validated DomainSpec options on the 0.1.2-rc.1 baseline.
    // Pin both fields so a typo can never silently drop the policy.
    expect(monitorDomain.layout).toBe('per-record')
    expect(monitorDomain.invalidRecords).toBe('backup-and-skip')
  })

  it('keeps every table name path-safe for the per-record layout', () => {
    // Per-record documents become file names (`[a-zA-Z0-9_-]+`); a table
    // name must never reintroduce an unsafe character (the write-side key
    // format is pinned by the `usage-2026-8` assertion above).
    for (const table of Object.keys(monitorDomain.tables)) {
      expect(table).toMatch(/^[a-zA-Z0-9_-]+$/)
    }
  })
})
