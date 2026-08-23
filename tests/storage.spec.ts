import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetSharedStoreForTests, sharedStore } from '../src/storage.ts'
import type { BalanceSnapshot } from '../src/wire.ts'

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
})
