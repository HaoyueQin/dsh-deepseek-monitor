import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRefresher } from '../src/refresher.ts'
import { DsmError, DEFAULT_PREFS, type BalanceSnapshot, type MonitorPrefs, type UsageResult } from '../src/wire.ts'

const snap = (): BalanceSnapshot => ({
  isAvailable: true,
  currency: 'CNY',
  totalBalance: '12.34',
  grantedBalance: '0.00',
  toppedUpBalance: '12.34',
  fetchedAt: 1,
})

interface Deps {
  balanceGets: ReturnType<typeof vi.fn>
  usageFetches: ReturnType<typeof vi.fn>
  prefs: MonitorPrefs
}

function makeDeps(overrides: Partial<MonitorPrefs> = {}): Deps {
  const prefs: MonitorPrefs = { ...DEFAULT_PREFS, ...overrides }
  return {
    balanceGets: vi.fn(async (_force: boolean) => snap()),
    usageFetches: vi.fn(async (): Promise<UsageResult> => ({ year: 2026, month: 8, models: [], days: [], monthCost: 0, fetchedAt: 1 })),
    prefs,
  }
}

function build(deps: Deps) {
  return createRefresher({
    store: {
      getPrefs: () => deps.prefs,
      // The store writes are incidental here; record nothing.
      setPrefs: async patch => ({ ...deps.prefs, ...patch }),
      getBalance: () => null,
      setBalance: async () => undefined,
      getUsage: () => null,
      setUsage: async () => undefined,
      clearCache: async () => undefined,
    },
    balance: { get: (force: boolean) => deps.balanceGets(force) },
    usage: { fetch: (year: number, month: number) => deps.usageFetches(year, month) },
    hasPlatformToken: async () => false,
  })
}

beforeEach(() => { vi.useFakeTimers() })

describe('refresher scheduling', () => {
  it('ticks once per configured interval', async () => {
    const deps = makeDeps()
    const r = build(deps)
    r.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(deps.balanceGets).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(deps.balanceGets).toHaveBeenCalledTimes(2)
  })

  it('does not schedule while auto-refresh is disabled', async () => {
    const deps = makeDeps({ autoRefreshEnabled: false })
    const r = build(deps)
    r.start()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(deps.balanceGets).not.toHaveBeenCalled()
  })
})

describe('refresher lifecycle regression (dispose+start must revive)', () => {
  it('keeps ticking after a prefs-update restart cycle', async () => {
    const deps = makeDeps({ refreshIntervalSeconds: 60 })
    const r = build(deps)
    r.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(deps.balanceGets).toHaveBeenCalledTimes(1)

    // Exactly what prefs.update() does host-side.
    r.dispose()
    r.start()

    await vi.advanceTimersByTimeAsync(60_000)
    // A one-shot disposed flag would leave this at 1 forever.
    expect(deps.balanceGets).toHaveBeenCalledTimes(2)
  })
})

describe('refresher error accounting', () => {
  it('reports a failed tick and clears the error once recovered', async () => {
    const deps = makeDeps()
    deps.balanceGets.mockRejectedValueOnce(new DsmError(502, 'upstream down'))
    const r = build(deps)
    r.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.lastError()).toBe('upstream down')

    // Next tick succeeds: the stale failure must NOT linger in lastError,
    // and refreshNow() must stop re-throwing it.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.lastError()).toBe('')
    await expect(r.refreshNow()).resolves.toBeUndefined()
  })

  it('refreshNow throws the CURRENT failure, not an older one', async () => {
    const deps = makeDeps()
    const r = build(deps)
    deps.balanceGets.mockRejectedValueOnce(new Error('network gone'))
    await expect(r.refreshNow()).rejects.toThrow('network gone')
    await expect(r.refreshNow()).resolves.toBeUndefined()
  })
})
