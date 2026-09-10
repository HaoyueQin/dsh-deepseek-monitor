/**
 * Locks the panel's daily-bar fold: the row-keyed path, the legacy-cache
 * rebuild, key-agnostic summation, and day-order preservation.
 */
import { describe, expect, it } from 'vitest'
import { foldChartPoints } from '../src/client/chart-fold.ts'
import type { UsageDaySummary } from '../src/wire.ts'

/** A day with the legacy columns zeroed out; tests override what they need. */
const day = (date: string, overrides: Partial<UsageDaySummary> = {}): UsageDaySummary => ({
  date,
  flashTokens: 0,
  flashCacheHit: 0,
  flashCacheMiss: 0,
  flashResponse: 0,
  proTokens: 0,
  proCacheHit: 0,
  proCacheMiss: 0,
  proResponse: 0,
  totalTokens: 0,
  totalCost: 0,
  ...overrides,
})

describe('foldChartPoints', () => {
  it('sums every bucket of a row-keyed day, whatever the keys are', () => {
    const points = foldChartPoints([
      day('2026-09-08', {
        totalTokens: 300,
        totalCost: 2.5,
        buckets: {
          'v41-flash': { hit: 100, miss: 10, response: 20 },
          'v4-flash': { hit: 5, miss: 0, response: 5 },
          pro: { hit: 0, miss: 0, response: 0 },
          other: { hit: 7, miss: 3, response: 150 },
        },
      }),
    ])
    expect(points).toEqual([
      { date: '2026-09-08', hit: 112, miss: 13, response: 175, total: 300, cost: 2.5 },
    ])
  })

  it('keeps a renamed or unknown bucket in the stack instead of dropping it', () => {
    const points = foldChartPoints([
      day('2026-09-08', { totalTokens: 11, buckets: { 'brand-new-key': { hit: 1, miss: 2, response: 8 } } }),
    ])
    expect(points[0]).toMatchObject({ hit: 1, miss: 2, response: 8 })
  })

  it('rebuilds the legacy flash/pro/other columns for a month cached before buckets', () => {
    const points = foldChartPoints([
      day('2026-08-02', {
        flashCacheHit: 100,
        flashCacheMiss: 10,
        flashResponse: 5,
        proCacheHit: 1,
        proCacheMiss: 2,
        proResponse: 3,
        otherCacheHit: 4,
        otherCacheMiss: 5,
        otherResponse: 6,
        totalTokens: 136,
        totalCost: 1.25,
      }),
    ])
    expect(points).toEqual([
      { date: '2026-08-02', hit: 105, miss: 17, response: 14, total: 136, cost: 1.25 },
    ])
  })

  it('treats absent legacy catch-all columns as zero', () => {
    // Rows persisted before those fields existed carry no other* keys at all.
    const legacy = day('2026-07-01', { flashCacheHit: 3, totalTokens: 3 })
    delete (legacy as { otherCacheHit?: number }).otherCacheHit
    expect(foldChartPoints([legacy])[0]).toMatchObject({ hit: 3, miss: 0, response: 0 })
  })

  it('preserves day order and yields an empty result for an empty month', () => {
    expect(foldChartPoints([])).toEqual([])
    const points = foldChartPoints([day('2026-09-03'), day('2026-09-01'), day('2026-09-02')])
    expect(points.map(p => p.date)).toEqual(['2026-09-03', '2026-09-01', '2026-09-02'])
  })
})
