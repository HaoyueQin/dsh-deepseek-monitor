/**
 * Platform usage-token management: the DeepSeek OPEN PLATFORM session token
 * (NOT the API key) that authenticates the internal
 * `platform.deepseek.com/api/v0/usage/*` endpoints. Ported from
 * DeepSeekMonitorWindows: a candidate is verified against
 * `/api/v0/usage/amount` for the current month (HTTP 200 = valid) before it
 * is stored through the credentials seam under its own reference, write-only
 * — no wire surface ever returns the value.
 */

import type { DsmCredentials } from './context-types.ts'
import { DsmError } from './wire.ts'

/** The credential reference this plugin owns for the platform token. */
export const PLATFORM_TOKEN_REF = 'DEEPSEEK_PLATFORM_TOKEN'

/** The platform usage endpoint + shared request chrome, exported so the usage
 *  service and the token verification reuse ONE copy (header drift between the
 *  two was the historical failure mode). */
export const USAGE_AMOUNT_URL = 'https://platform.deepseek.com/api/v0/usage/amount'
export const TIMEOUT_MS = 15_000

/** Browser-grade UA + app-version headers, as the platform endpoint expects. */
export const PLATFORM_REQUEST_HEADERS: Record<string, string> = {
  'x-app-version': '1.0.0',
  accept: '*/*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
}

export interface PlatformTokenDeps {
  credentials: Pick<DsmCredentials, 'resolve' | 'describe' | 'set' | 'unset'>
}

/**
 * Verify a candidate token against the current month's usage endpoint.
 * Mirrors DSM's verify_usage_token: 200 = valid; 401 = invalid/expired;
 * anything else names the status.
 */
export async function verifyUsageToken(token: string): Promise<void> {
  const now = new Date()
  const url = `${USAGE_AMOUNT_URL}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`
  let response: Response
  try {
    response = await fetch(url, {
      headers: { ...PLATFORM_REQUEST_HEADERS, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new DsmError(502, `验证 token 失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (response.status === 200) return
  if (response.status === 401) throw new DsmError(401, 'token 无效或已过期')
  if (response.status === 429) throw new DsmError(429, '请求过于频繁，请稍后再试')
  throw new DsmError(502, `平台接口返回 HTTP ${response.status}（接口可能已变更）`)
}

export function createPlatformTokenService(deps: PlatformTokenDeps): {
  verifyAndStore(token: string): Promise<void>
  clear(): Promise<void>
  describe(): Promise<{ configured: boolean, writable?: boolean }>
} {
  return {
    /** Verify first, then store — an invalid token never lands. */
    async verifyAndStore(token: string): Promise<void> {
      const value = token.trim()
      if (value === '') throw new DsmError(400, 'token 不能为空')
      await verifyUsageToken(value)
      await deps.credentials.set(PLATFORM_TOKEN_REF, value)
    },
    async clear(): Promise<void> {
      await deps.credentials.unset(PLATFORM_TOKEN_REF)
    },
    async describe(): Promise<{ configured: boolean, writable?: boolean }> {
      const info = await deps.credentials.describe(PLATFORM_TOKEN_REF)
      return info.configured ? { configured: true, writable: info.writable } : { configured: false }
    },
  }
}
