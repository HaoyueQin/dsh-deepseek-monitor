/**
 * Pure usage-row fold for the provider panel: which reported models render
 * as rows, in what order, and the progress-bar scale. Kept outside the TSX
 * so the legacy filter + display order are unit-testable.
 *
 * ponytail: if the platform renames or adds a model, add its key to
 * ROW_ORDER here (one line); unknown keys already degrade gracefully into
 * the name-sorted "anything else" bucket, so a new id never breaks the
 * panel — it just lands after Pro until ranked.
 */
import type { UsageModelSummary } from '../wire.ts'

/** Retired model ids the panel never renders (matched on name or key). The
 *  host already skips these while building the row list, so this guards the
 *  other direction: rows folded into a month cache by an older build, and the
 *  raw-id fallback row an unrecognised model gets. */
export const LEGACY_MODELS: ReadonlySet<string> = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-chat & deepseek-reasoner',
])

/** Display order by row key: V4.1 Flash → V4 Flash → Pro → Flash Vision;
 *  anything else sorts after Vision by name. The vision entry sits last on
 *  purpose — it is the experimental sibling of the Flash line, and grouping
 *  the two production Flash rows first keeps the accounting rows adjacent. */
export const ROW_ORDER: ReadonlyMap<string, number> = new Map([
  ['v41-flash', 0],
  ['v4-flash', 1],
  ['pro', 2],
  ['flash-vision', 3],
])

/** Stacking/colour order of one day's buckets. `other` trails on purpose: it
 *  is the catch-all for ids without a row, so it must never displace a named
 *  model's colour. Unknown keys sort after those, by name. */
export const SEGMENT_ORDER: ReadonlyArray<string> = ['v41-flash', 'v4-flash', 'pro', 'flash-vision', 'other']

/** Bit index of a bucket key in the chart legend/colour map. */
export function segmentOrderOf(key: string): number {
  const idx = SEGMENT_ORDER.indexOf(key)
  return idx === -1 ? SEGMENT_ORDER.length : idx
}

/** History-depth guard: the host routes reject year < 2020, so the back-step
 *  caps at 5 years (60 months) — the ‹ button disables there. */
export const MAX_MONTH_OFFSET = 60

/**
 * Filter the retired legacy rows and sort the rest for display. The input is
 * never mutated (filter copies before sort).
 */
export function selectRowModels(models: readonly UsageModelSummary[]): UsageModelSummary[] {
  return models
    .filter(m => !LEGACY_MODELS.has(m.name) && !LEGACY_MODELS.has(m.key))
    .sort((a, b) => (ROW_ORDER.get(a.key) ?? 99) - (ROW_ORDER.get(b.key) ?? 99) || a.name.localeCompare(b.name))
}

/** Scale denominator for the per-row progress bars; the floor of 1 keeps an
 *  empty month division-safe. */
export function maxRowTokens(rowModels: readonly UsageModelSummary[]): number {
  return Math.max(...rowModels.map(m => m.totalTokens), 1)
}
