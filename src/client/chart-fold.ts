/**
 * Chart fold for the daily stacked bars, kept as a pure module so the shape
 * that ships to the browser is unit-testable without a DOM. A month's days
 * carry a row-keyed `buckets` map (see UsageDaySummary); a month cached by an
 * earlier build carries only the three legacy per-model columns, which are
 * rebuilt here so an already-cached month keeps rendering exactly as it did.
 */
import type { UsageDaySummary } from '../wire.ts'

/** One bar: the day's stacked segments plus the totals its height and tooltip
 *  read from. */
export interface ChartPoint {
  date: string
  hit: number
  miss: number
  response: number
  total: number
  cost: number
}

/** The pre-buckets daily columns, rebuilt into the row keys a legacy cache
 *  used: its flash column WAS V4 Flash and its pro column WAS V4 Pro, while
 *  every other model already sat in the catch-all. */
function legacyBuckets(day: UsageDaySummary): Record<string, { hit: number, miss: number, response: number }> {
  return {
    'v4-flash': { hit: day.flashCacheHit, miss: day.flashCacheMiss, response: day.flashResponse },
    pro: { hit: day.proCacheHit, miss: day.proCacheMiss, response: day.proResponse },
    other: { hit: day.otherCacheHit ?? 0, miss: day.otherCacheMiss ?? 0, response: day.otherResponse ?? 0 },
  }
}

/**
 * Fold every reported model's daily buckets into one hit/miss/response stack
 * per day, so a segment stack always fills the bar height its total implies.
 * Key names carry no meaning here — the segments are summed across all of
 * them, which is why an unknown or renamed bucket cannot distort a bar.
 */
export function foldChartPoints(days: readonly UsageDaySummary[]): ChartPoint[] {
  return days.map((day) => {
    const buckets = day.buckets ?? legacyBuckets(day)
    let hit = 0
    let miss = 0
    let response = 0
    for (const bucket of Object.values(buckets)) {
      hit += bucket.hit
      miss += bucket.miss
      response += bucket.response
    }
    return { date: day.date, hit, miss, response, total: day.totalTokens, cost: day.totalCost }
  })
}
