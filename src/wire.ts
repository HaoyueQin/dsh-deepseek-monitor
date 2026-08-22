/**
 * Wire contract shared by the host half and the browser half, plus the JSON
 * request/response helpers for the /dsm/api route handlers. No Node or DOM
 * types leak into the shared declarations — the HTTP helpers are host-only
 * and use Buffer through a structural local (the file is host-bundle-only;
 * it never enters the client declaration graph).
 */

import type { DsmHttpRequest, DsmHttpResponse } from './context-types.ts'

/** The identity/status payload. Fields are additive across versions. */
export interface MonitorStatus {
  plugin: 'dsh-deepseek-monitor'
  version: string
  /** Endpoints this build serves (capability probe for the UI). */
  endpoints: readonly string[]
  /** The reused DeepSeek API key state (never the value). */
  apiKey: { configured: boolean }
  /** The platform usage token state (never the value). */
  platformToken: { configured: boolean, writable?: boolean }
  /** Cached balance snapshot; null until first successful fetch. */
  balance: BalanceSnapshot | null
  /** True when balance ≤ threshold and low-balance alerts are on. */
  lowBalance?: boolean
  /** The configured threshold, echoed for UI hints. */
  lowBalanceThreshold?: number
  /** The most recent refresher failure (omitted when ''). */
  lastError?: string
}

/** User preferences persisted in the plugin's storage domain. */
export interface MonitorPrefs {
  autoRefreshEnabled: boolean
  refreshIntervalSeconds: number
  lowBalanceNotify: boolean
  lowBalanceThreshold: number
}

export const DEFAULT_PREFS: MonitorPrefs = {
  autoRefreshEnabled: true,
  refreshIntervalSeconds: 60,
  lowBalanceNotify: false,
  lowBalanceThreshold: 10,
}

/** One balance snapshot from the official /user/balance API (values verbatim
 *  strings from DeepSeek; display joins currency). */
export interface BalanceSnapshot {
  isAvailable: boolean
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
  /** Unix epoch ms of the upstream fetch. */
  fetchedAt: number
}

/** The provider/model route one session last served. */
export interface ModelRouteInfo {
  provider: string
  model: string
}

// ── Usage wire (ported from DSM types.rs) ─────────────────────────────────

/** One model's month-to-date usage summary. */
export interface UsageModelSummary {
  key: string
  name: string
  totalTokens: number
  requestCount: number
  cacheHitTokens: number
  cacheMissTokens: number
  responseTokens: number
  cost: number
}

/** One day's per-model usage within a month. */
export interface UsageDaySummary {
  date: string
  flashTokens: number
  flashCacheHit: number
  flashCacheMiss: number
  flashResponse: number
  proTokens: number
  proCacheHit: number
  proCacheMiss: number
  proResponse: number
  totalTokens: number
  totalCost: number
}

/** The full usage result for one month (amount + cost joined). */
export interface UsageResult {
  year: number
  month: number
  models: UsageModelSummary[]
  days: UsageDaySummary[]
  monthCost: number
  /** Unix epoch ms of the upstream fetch that produced this result. */
  fetchedAt: number
}

// ── HTTP helpers (host half only) ─────────────────────────────────────────

const byteLength = (chunk: string | Uint8Array): number =>
  typeof chunk === 'string' ? chunk.length : chunk.byteLength

/** Default cap for a JSON request body; bounds only a misbehaving trusted client. */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Read an async-iterable request body as UTF-8 text. */
async function readBodyText(req: DsmHttpRequest, maxBytes: number): Promise<string> {
  let body = ''
  let bytes = 0
  for await (const chunk of req) {
    bytes += byteLength(chunk)
    if (bytes > maxBytes) {
      throw new DsmError(413, `request body exceeds ${maxBytes} bytes`)
    }
    body += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
  }
  return body
}

/** Read and parse a JSON request body; empty body yields undefined. */
export async function readJsonBody(req: DsmHttpRequest, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const body = await readBodyText(req, maxBytes)
  if (body === '') return undefined
  try {
    return JSON.parse(body)
  } catch {
    throw new DsmError(400, 'invalid json body')
  }
}

/** A user-visible error carrying its HTTP status. */
export class DsmError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function writeJson(res: DsmHttpResponse, value: unknown, status = 200): void {
  res.statusCode = status
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export function writeError(res: DsmHttpResponse, err: unknown): void {
  const status = err instanceof DsmError ? err.status : 500
  // Deliberate 4xx carries its user-facing message; an unexpected 500 must
  // not echo internal error text to the client.
  const message = err instanceof DsmError ? err.message : 'internal error'
  writeJson(res, { ok: false, error: { code: 'dsm_api_error', message } }, status)
}
