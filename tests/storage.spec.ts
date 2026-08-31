import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetSharedStoreForTests, sharedStore } from '../src/storage.ts'
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
      usage: new Map<string, unknown>(),
      index: new Map<string, unknown>(),
    }
    const kv = (m: Map<string, unknown>) => ({
      get: (k: string) => m.get(k),
      put: async (k: string, v: unknown) => { m.set(k, v) },
      delete: async (k: string) => m.delete(k),
    })
    const domainStub = {
      open: () => opened.then(() => ({
        table: (name: string) => kv(backing[name === 'prefs' ? 'prefs' : name === 'index' ? 'index' : 'usage']),
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
      expect(backing.usage.get('balance')).toBeTruthy()
    })

    // Reads now come from the REAL tables (a memory-only row would vanish).
    expect(backing.usage.get('balance')).toMatchObject({ totalBalance: '5.00' })
    expect(store.getPrefs().refreshIntervalSeconds).toBe(120)
    expect(store.getBalance()?.currency).toBe('USD')
  })

  it('reads a legacy prefs row (no composerChipEnabled) as enabled after the swap', async () => {
    const backing = {
      prefs: new Map<string, unknown>(),
      usage: new Map<string, unknown>(),
      index: new Map<string, unknown>(),
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
      put: async (k: string, v: unknown) => { m.set(k, v) },
      delete: async (k: string) => m.delete(k),
    })
    const domainStub = {
      open: async () => ({
        table: (name: string) => kv(name === 'prefs' ? backing.prefs : name === 'index' ? backing.index : backing.usage),
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

describe('cache-index write serialization', () => {
  it('never loses a month key when concurrent writes and clearCache interleave', async () => {
    _resetSharedStoreForTests()
    const backing = {
      prefs: new Map<string, unknown>(),
      usage: new Map<string, unknown>(),
      index: new Map<string, unknown>(),
    }
    // Async kv with a delayed write: without index serialization two
    // concurrent setUsage calls both read the index row before either put
    // lands, and the later put drops the earlier call's key.
    const kv = (m: Map<string, unknown>) => ({
      get: (k: string) => m.get(k),
      put: async (k: string, v: unknown) => { await new Promise(resolve => setTimeout(resolve, 0)); m.set(k, v) },
      delete: async (k: string) => { await new Promise(resolve => setTimeout(resolve, 0)); m.delete(k) },
    })
    let resolveOpen!: () => void
    const opened = new Promise<void>(resolve => { resolveOpen = resolve })
    const domainStub = {
      open: () => opened.then(() => ({
        table: (name: string) => kv(name === 'prefs' ? backing.prefs : name === 'index' ? backing.index : backing.usage),
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
    // clearCache deletes every row named in the index; a lost key would
    // leave its row behind and keep serving stale data.
    expect(store.getUsage(2026, 1)).toBeNull()
    expect(store.getUsage(2026, 2)).toBeNull()
  })
})
