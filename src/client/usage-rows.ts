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

/** Retired model ids the panel never renders (matched on name or key). */
export const LEGACY_MODELS: ReadonlySet<string> = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-chat & deepseek-reasoner',
])

/** Display order by row key: Flash → Flash Vision → Pro; anything else sorts
 *  after Pro by name. */
export const ROW_ORDER: ReadonlyMap<string, number> = new Map([
  ['flash', 0],
  ['flash-vision', 1],
  ['pro', 2],
])

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
