/**
 * Platform usage service: fetches the open platform's internal
 * `/api/v0/usage/amount` + `/api/v0/usage/cost` for one month with the stored
 * platform token, and folds them into per-model / per-day summaries. A direct
 * TypeScript port of DeepSeekMonitorWindows' do_fetch_usage +
 * token_breakdown + cost_sum (deepseek.rs), including the tolerant parsing
 * rules (unknown entry kinds ignored; unparsable amounts count as zero).
 *
 * WHICH platform ids become panel rows is a product decision, not a platform
 * fact: the platform reports ids for models that never had a row here (the
 * retired chat/reasoner pair) and ids that are NOT aliases of each other (V4
 * Flash and V4.1 Flash are two generations, so they stay two rows). One model
 * split across account-period ids — the dated V4.1 Flash id and
 * `deepseek-flash` — still pools into ONE row; see MODEL_LABELS.
 */

import type { DsmCredentials } from './context-types.ts'
import type { UsageDaySummary, UsageModelSummary, UsageResult } from './wire.ts'
import { DsmError } from './wire.ts'
import { PLATFORM_REQUEST_HEADERS, PLATFORM_TOKEN_REF, TIMEOUT_MS, USAGE_AMOUNT_URL } from './platform-token.ts'

const COST_URL = 'https://platform.deepseek.com/api/v0/usage/cost'

/** One panel row: its stable key plus the name the panel renders. */
export interface RowLabel {
  key: string
  /** Shown in the panel. Official PRODUCT name per user decision — map any
   *  official id by its documented model version (official docs:
   *  deepseek-flash = DeepSeek-V4.1-Flash, deepseek-v4-pro =
   *  DeepSeek-V4-Pro-0813), NOT by the platform's internal id spelling. */
  name: string
}

/** Platform model id → panel row. Several ids may share one row: the
 *  platform splits ONE model across account-period ids, and rendering them as
 *  two rows would cut that model's usage in half (the panel shows both totals
 *  and each one would read short). */
const MODEL_LABELS: Record<string, RowLabel> = {
  'deepseek-v4.1-flash-expires-on-0910': { key: 'v41-flash', name: 'DeepSeek-V4.1-Flash' },
  'deepseek-flash': { key: 'v41-flash', name: 'DeepSeek-V4.1-Flash' },
  'deepseek-v4-flash': { key: 'v4-flash', name: 'DeepSeek-V4-Flash' },
  'deepseek-v4-pro': { key: 'pro', name: 'DeepSeek-V4-Pro' },
  'deepseek-v4-flash-vision-exp': { key: 'flash-vision', name: 'DeepSeek-V4-Flash-Vision-Exp' },
}

/** Retired platform ids mapped onto the live row they belong to for bucket
 *  accounting (a dated id whose model was later renamed). */
const LEGACY_ID_ALIASES: Record<string, RowLabel> = {
  'deepseek-v4-flash-0731': { key: 'v4-flash', name: 'DeepSeek-V4-Flash' },
  'deepseek-v4-pro-0813': { key: 'pro', name: 'DeepSeek-V4-Pro' },
}

/** Platform ids that get NEITHER a panel row NOR a bucket of their own: the
 *  retired chat/reasoner pair, reported only for historical months. Their
 *  tokens and cost still reach the month total and the chart — they simply
 *  have no identity in this UI, so they land under {@link BUCKETS_KEY}.
 *  Kept explicit rather than left to the unknown-id path so the retirement is
 *  a recorded decision: drop an id here the day the panel wants its row. */
const NO_ROW_MODEL_IDS: ReadonlySet<string> = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-chat & deepseek-reasoner',
])

/** Panel row for one platform id; undefined = no dedicated row (the daily
 *  chart still books its tokens under the "other" bucket). */
const rowLabelOf = (id: string | undefined): RowLabel | undefined =>
  id === undefined || NO_ROW_MODEL_IDS.has(id)
    ? undefined
    : MODEL_LABELS[id] ?? LEGACY_ID_ALIASES[id]

/** Daily bucket for models the panel has no row for. */
export const BUCKETS_KEY = 'other'

interface UsageEntry {
  type?: string
  amount?: string
}
interface UsageModelBlock {
  model?: string
  usage?: UsageEntry[]
}
interface AmountResponse {
  data?: { biz_data?: { total?: UsageModelBlock[], days?: Array<{ date?: string, data?: UsageModelBlock[] }> } }
}
interface CostResponse {
  data?: { biz_data?: Array<{ total?: UsageModelBlock[], days?: Array<{ date?: string, data?: UsageModelBlock[] }> }> }
}

/**
 * Strict amount parsing, mirroring upstream parse::<f64>().unwrap_or(0.0):
 * the WHOLE string must be a finite number ('12abc' is 0, not 12). Falls back
 * to 0 for absent amounts so a missing field costs nothing.
 */
function parseAmountStrict(raw: string | undefined): number {
  if (raw === undefined) return 0
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : 0
}

/** Sum a usage block into (total, request, hit, miss, response) — DSM token_breakdown. */
export function tokenBreakdown(usage: UsageEntry[]): { total: number, request: number, hit: number, miss: number, response: number } {
  let total = 0
  let request = 0
  let hit = 0
  let miss = 0
  let response = 0
  for (const entry of usage) {
    // Upstream rounds EACH entry (clamp then round) and sums the rounded
    // values; a sum-then-round port would drift by up to N/2 on fractional
    // amounts. The per-entry value is an integer, so totals sum exactly.
    const value = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(parseAmountStrict(entry.amount))))
    switch (entry.type) {
      // Each bucket is the LAST entry of its kind, not a running sum, and the
      // kinds that feed `total` add per entry. That asymmetry is upstream's
      // (DSM sums rounded entries), and the named buckets plus the total must
      // stay on ONE tolerance: accumulating raw then rounding would let
      // hit + miss + response drift away from the total the same payload
      // produces.
      case 'REQUEST':
        request = value
        break
      case 'PROMPT_CACHE_HIT_TOKEN':
        hit = value
        total += value
        break
      case 'PROMPT_CACHE_MISS_TOKEN':
        miss = value
        total += value
        break
      case 'RESPONSE_TOKEN':
        response = value
        total += value
        break
      case 'PROMPT_TOKEN':
        total += value
        break
      default:
        break
    }
  }
  // Per-entry integers sum exactly — the old sum-then-round is gone.
  return { total, request, hit, miss, response }
}

/** Monetary sum of a usage block excluding REQUEST entries — DSM cost_sum. */
export function costSum(usage: UsageEntry[]): number {
  return usage
    .filter(entry => entry.type !== 'REQUEST')
    .reduce((sum, entry) => sum + parseAmountStrict(entry.amount), 0)
}

export interface UsageDeps {
  credentials: Pick<DsmCredentials, 'resolve'>
}

async function getJson<T>(url: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { ...PLATFORM_REQUEST_HEADERS, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    // cause comes from fetch/AbortSignal only (network/timeout) — the token
    // value never enters an Error message on this path.
    throw new DsmError(502, `用量请求失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (response.status === 401) throw new DsmError(401, '平台 Token 无效或已过期，请重新配置')
  if (response.status === 429) throw new DsmError(429, '请求过于频繁，请稍后再试')
  if (!response.ok) throw new DsmError(502, `用量接口返回 HTTP ${response.status}（接口可能已变更）`)
  try {
    return await response.json() as T
  } catch {
    throw new DsmError(502, '解析用量数据失败')
  }
}

export function createUsageService(deps: UsageDeps): {
  fetch(year: number, month: number): Promise<UsageResult>
} {
  return {
    async fetch(year: number, month: number): Promise<UsageResult> {
      const resolved = await deps.credentials.resolve(PLATFORM_TOKEN_REF)
      if (resolved === undefined) throw new DsmError(409, '尚未配置平台用量 Token')
      // Both endpoints are required for one month fold; fire them in parallel
      // so a month load costs one RTT, not two. Rejection keeps the sequential
      // semantics: the first failure (401/429/502, same DsmError surface)
      // fails the month fetch as a whole.
      const [amount, cost] = await Promise.all([
        getJson<AmountResponse>(`${USAGE_AMOUNT_URL}?month=${month}&year=${year}`, resolved.value),
        getJson<CostResponse>(`${COST_URL}?month=${month}&year=${year}`, resolved.value),
      ])

      const amountBiz = amount.data?.biz_data
      const costTotal = cost.data?.biz_data?.[0]

      // Screen rows aggregate by PANEL ROW, not by platform id: one model
      // reported under two account-period ids must read as one row, or its
      // tokens and cost are split across two rows that each look short.
      const costByRow = new Map<string, number>()
      for (const block of costTotal?.total ?? []) {
        if (block.model === undefined) continue
        const key = rowLabelOf(block.model)?.key ?? block.model
        costByRow.set(key, (costByRow.get(key) ?? 0) + costSum(block.usage ?? []))
      }

      const byKey = new Map<string, UsageModelSummary>()
      for (const block of amountBiz?.total ?? []) {
        if (block.model === undefined) continue
        // A retired id the platform still reports keeps its tokens in the
        // daily buckets (and the month total) but gets no row of its own.
        if (NO_ROW_MODEL_IDS.has(block.model)) continue
        const label = rowLabelOf(block.model) ?? { key: block.model, name: block.model }
        const breakdown = tokenBreakdown(block.usage ?? [])
        const cost = costByRow.get(label.key) ?? 0
        const existing = byKey.get(label.key)
        if (existing === undefined) {
          byKey.set(label.key, {
            key: label.key,
            name: label.name,
            totalTokens: breakdown.total,
            requestCount: breakdown.request,
            cacheHitTokens: breakdown.hit,
            cacheMissTokens: breakdown.miss,
            responseTokens: breakdown.response,
            cost: Number.parseFloat(cost.toFixed(4)),
          })
          continue
        }
        existing.totalTokens += breakdown.total
        existing.requestCount += breakdown.request
        existing.cacheHitTokens += breakdown.hit
        existing.cacheMissTokens += breakdown.miss
        existing.responseTokens += breakdown.response
        // `cost` is already pooled per row above, so it is NOT summed again
        // here — doing both double-counts a two-id row.
      }
      const models: UsageModelSummary[] = [...byKey.values()]

      const costByDate = new Map<string, number>()
      for (const day of costTotal?.days ?? []) {
        if (day.date === undefined) continue
        costByDate.set(day.date, (day.data ?? []).reduce((sum, block) => sum + costSum(block.usage ?? []), 0))
      }

      const days: UsageDaySummary[] = []
      for (const day of amountBiz?.days ?? []) {
        if (day.date === undefined) continue
        const summary: UsageDaySummary = {
          date: day.date,
          flashTokens: 0, flashCacheHit: 0, flashCacheMiss: 0, flashResponse: 0,
          proTokens: 0, proCacheHit: 0, proCacheMiss: 0, proResponse: 0,
          buckets: {},
          totalTokens: 0,
          totalCost: Number.parseFloat((costByDate.get(day.date) ?? 0).toFixed(4)),
        }
        for (const block of day.data ?? []) {
          const b = tokenBreakdown(block.usage ?? [])
          summary.totalTokens += b.total
          // Every known id lands under its OWN panel row, so a model split
          // across two platform ids (the V4.1 Flash account-period pair)
          // pools into one daily bucket. An id with no row — a retired one
          // the platform still reports, or one newer than this build — falls
          // into "other" rather than vanishing: its tokens MUST still reach
          // the chart or the stacked segments fall short of the bar height
          // the total implies.
          const bucketKey = rowLabelOf(block.model)?.key ?? BUCKETS_KEY
          const bucket = summary.buckets![bucketKey] ?? { hit: 0, miss: 0, response: 0 }
          bucket.hit += b.hit
          bucket.miss += b.miss
          bucket.response += b.response
          summary.buckets![bucketKey] = bucket
        }
        days.push(summary)
      }

      const monthCost = (costTotal?.total ?? []).reduce((sum, block) => sum + costSum(block.usage ?? []), 0)
      return { year, month, models, days, monthCost: Number.parseFloat(monthCost.toFixed(4)), fetchedAt: Date.now() }
    },
  }
}
