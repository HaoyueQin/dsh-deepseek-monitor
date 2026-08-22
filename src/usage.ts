/**
 * Platform usage service: fetches the open platform's internal
 * `/api/v0/usage/amount` + `/api/v0/usage/cost` for one month with the stored
 * platform token, and folds them into per-model / per-day summaries. A direct
 * TypeScript port of DeepSeekMonitorWindows' do_fetch_usage +
 * token_breakdown + cost_sum (deepseek.rs), including the tolerant parsing
 * rules (unknown entry kinds ignored; unparsable amounts count as zero).
 */

import type { DsmCredentials } from './context-types.ts'
import type { UsageDaySummary, UsageModelSummary, UsageResult } from './wire.ts'
import { DsmError } from './wire.ts'
import { PLATFORM_TOKEN_REF } from './platform-token.ts'

const AMOUNT_URL = 'https://platform.deepseek.com/api/v0/usage/amount'
const COST_URL = 'https://platform.deepseek.com/api/v0/usage/cost'
const TIMEOUT_MS = 15_000

const REQUEST_HEADERS: Record<string, string> = {
  'x-app-version': '1.0.0',
  accept: '*/*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
}

/** Model display labels: full platform ids as names (per product decision);
 *  unknown ids keep their raw id. */
const MODEL_LABELS: Record<string, { key: string, name: string }> = {
  'deepseek-v4-flash': { key: 'flash', name: 'deepseek-v4-flash' },
  'deepseek-v4-pro': { key: 'pro', name: 'deepseek-v4-pro' },
  'deepseek-v4-flash-vision-exp': { key: 'flash-vision', name: 'deepseek-v4-flash-vision-exp' },
}

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

/** Sum a usage block into (total, request, hit, miss, response) — DSM token_breakdown. */
export function tokenBreakdown(usage: UsageEntry[]): { total: number, request: number, hit: number, miss: number, response: number } {
  let total = 0
  let request = 0
  let hit = 0
  let miss = 0
  let response = 0
  for (const entry of usage) {
    const value = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number.parseFloat(entry.amount ?? '') || 0))
    switch (entry.type) {
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
  return { total: Math.round(total), request: Math.round(request), hit: Math.round(hit), miss: Math.round(miss), response: Math.round(response) }
}

/** Monetary sum of a usage block excluding REQUEST entries — DSM cost_sum. */
export function costSum(usage: UsageEntry[]): number {
  return usage
    .filter(entry => entry.type !== 'REQUEST')
    .reduce((sum, entry) => sum + (Number.parseFloat(entry.amount ?? '') || 0), 0)
}

export interface UsageDeps {
  credentials: Pick<DsmCredentials, 'resolve'>
}

async function getJson<T>(url: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { ...REQUEST_HEADERS, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
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
      const amount = await getJson<AmountResponse>(`${AMOUNT_URL}?month=${month}&year=${year}`, resolved.value)
      const cost = await getJson<CostResponse>(`${COST_URL}?month=${month}&year=${year}`, resolved.value)

      const amountBiz = amount.data?.biz_data
      const costTotal = cost.data?.biz_data?.[0]

      const costForModel = (model: string): number =>
        costTotal?.total?.find(block => block.model === model)?.usage !== undefined
          ? costSum(costTotal.total.find(block => block.model === model)?.usage ?? [])
          : 0

      const models: UsageModelSummary[] = []
      for (const block of amountBiz?.total ?? []) {
        if (block.model === undefined) continue
        const label = MODEL_LABELS[block.model] ?? { key: block.model, name: block.model }
        const breakdown = tokenBreakdown(block.usage ?? [])
        models.push({
          key: label.key,
          name: label.name,
          totalTokens: breakdown.total,
          requestCount: breakdown.request,
          cacheHitTokens: breakdown.hit,
          cacheMissTokens: breakdown.miss,
          responseTokens: breakdown.response,
          cost: Number.parseFloat(costForModel(block.model).toFixed(4)),
        })
      }

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
          totalTokens: 0,
          totalCost: Number.parseFloat((costByDate.get(day.date) ?? 0).toFixed(4)),
        }
        for (const block of day.data ?? []) {
          const b = tokenBreakdown(block.usage ?? [])
          summary.totalTokens += b.total
          if (block.model === 'deepseek-v4-flash') {
            summary.flashTokens += b.total
            summary.flashCacheHit += b.hit
            summary.flashCacheMiss += b.miss
            summary.flashResponse += b.response
          } else if (block.model === 'deepseek-v4-pro') {
            summary.proTokens += b.total
            summary.proCacheHit += b.hit
            summary.proCacheMiss += b.miss
            summary.proResponse += b.response
          }
        }
        days.push(summary)
      }

      const monthCost = (costTotal?.total ?? []).reduce((sum, block) => sum + costSum(block.usage ?? []), 0)
      return { year, month, models, days, monthCost: Number.parseFloat(monthCost.toFixed(4)), fetchedAt: Date.now() }
    },
  }
}
