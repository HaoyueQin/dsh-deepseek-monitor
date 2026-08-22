/**
 * Balance service: the official `GET https://api.deepseek.com/user/balance`
 * endpoint authenticated by the SAME API key the harness's llm-deepseek
 * adapter resolves (default reference `DEEPSEEK_API_KEY`, re-resolved per
 * operation so a rotated key reaches the next fetch). A small TTL cache keeps
 * the polite-cadence contract: upstream is hit at most once per window unless
 * a refresh is forced.
 *
 * Direct port of DeepSeekMonitorWindows' do_fetch_balance (deepseek.rs),
 * including its status-code error classes.
 */

import type { DsmCredentials } from './context-types.ts'
import type { BalanceSnapshot } from './wire.ts'
import { DsmError } from './wire.ts'

/** The credential reference the official adapter derives by default. */
export const DEFAULT_KEY_REF = 'DEEPSEEK_API_KEY'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const TTL_MS = 60_000
const TIMEOUT_MS = 15_000

export interface BalanceDeps {
  credentials: Pick<DsmCredentials, 'resolve' | 'describe'>
  /** Override the default key reference (config surface). */
  keyRef?: string
}

export function createBalanceService(deps: BalanceDeps): {
  /** Cached-or-fetch read; throws the refresh error when no fresh cache serves. */
  get(force: boolean): Promise<BalanceSnapshot>
  /** Cache-only read for status surfaces (never touches upstream). */
  peek(): BalanceSnapshot | null
  /** The most recent refresh failure message ('' when the last attempt succeeded). */
  lastError(): string
} {
  let snapshot: BalanceSnapshot | null = null
  let fetchedAt = 0
  let error = ''
  let inFlight: Promise<BalanceSnapshot> | null = null
  let loggedPayload = false

  const fetchFresh = async (): Promise<BalanceSnapshot> => {
    const resolved = await deps.credentials.resolve(deps.keyRef ?? DEFAULT_KEY_REF)
    if (resolved === undefined) throw new DsmError(409, 'DeepSeek API Key 未配置（设置→模型→DeepSeek）')
    let response: Response
    try {
      response = await fetch(BALANCE_URL, {
        headers: { authorization: `Bearer ${resolved.value}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (cause) {
      throw new DsmError(502, `网络请求失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (response.status === 401) throw new DsmError(401, 'API Key 无效或已过期')
    if (response.status === 429) throw new DsmError(429, '请求过于频繁，请稍后再试')
    if (!response.ok) throw new DsmError(502, `余额接口返回 HTTP ${response.status}`)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new DsmError(502, '解析余额数据失败')
    }
    const parsed = body as {
      is_available?: boolean
      balance_infos?: Array<{ currency?: string, total_balance?: string, granted_balance?: string, topped_up_balance?: string }>
    }
    // Diagnostics (first fetch per process only): the API returns MULTIPLE
    // currency entries (USD before CNY observed 2026-08-22) — logging the raw
    // shape guards against ordering/shape drift. No secrets in the payload.
    if (!loggedPayload) {
      loggedPayload = true
      console.info('[dsm-balance] raw payload:', JSON.stringify(body))
    }
    const infos = parsed.balance_infos ?? []
    const info = infos.find(entry => entry.currency === 'CNY') ?? infos[0]
    if (info === undefined || typeof info.total_balance !== 'string') {
      throw new DsmError(502, '余额信息为空或接口形状已变更')
    }
    return {
      isAvailable: parsed.is_available === true,
      currency: info.currency ?? 'CNY',
      totalBalance: info.total_balance,
      grantedBalance: info.granted_balance ?? '0.00',
      toppedUpBalance: info.topped_up_balance ?? '0.00',
      fetchedAt: Date.now(),
    }
  }

  return {
    async get(force: boolean): Promise<BalanceSnapshot> {
      const fresh = snapshot !== null && Date.now() - fetchedAt < TTL_MS && error === ''
      if (!force && fresh) return snapshot as BalanceSnapshot
      if (inFlight !== null) return inFlight
      inFlight = fetchFresh()
        .then((next) => {
          snapshot = next
          fetchedAt = next.fetchedAt
          error = ''
          return next
        })
        .catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : String(cause)
          throw cause
        })
        .finally(() => { inFlight = null })
      return inFlight
    },
    peek(): BalanceSnapshot | null {
      return snapshot
    },
    lastError(): string {
      return error
    },
  }
}
