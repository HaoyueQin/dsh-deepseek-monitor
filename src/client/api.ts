/**
 * Browser-side access to the plugin's own fenced /dsm/api route. Components
 * stay pure renderers; all host traffic goes through here.
 */

import type { BalanceSnapshot, ModelRouteInfo, MonitorPrefs, MonitorStatus, UsageResult } from '../wire.ts'

interface ApiEnvelope<T> {
  ok: boolean
  value?: T
  error?: { code: string, message: string }
}

/** Generic same-origin JSON caller for /dsm/api. */
export async function dsmApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || !body.ok || body.value === undefined) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  }
  return body.value
}

/** The identity/status payload. */
export function fetchStatus(): Promise<MonitorStatus> {
  return dsmApi<MonitorStatus>('/dsm/api/status')
}

/** The provider/model route one session last served (null before any call). */
export async function fetchSessionRoute(sessionId: string): Promise<ModelRouteInfo | null> {
  const value = await dsmApi<{ route: ModelRouteInfo | null }>('/dsm/api/route', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
  return value.route
}

/** Force-refresh the balance snapshot from the official API. */
export function fetchBalance(): Promise<BalanceSnapshot> {
  return dsmApi<BalanceSnapshot>('/dsm/api/balance', { method: 'POST', body: JSON.stringify({ force: true }) })
}

/** Store (verify-first) or clear the platform usage token. */
export function postToken(action: 'set' | 'clear', value?: string): Promise<{ configured: boolean, writable?: boolean }> {
  return dsmApi(`/dsm/api/token`, { method: 'POST', body: JSON.stringify({ action, ...(value === undefined ? {} : { value }) }) })
}

/** One month's usage (cache-first on the host; force bypasses). */
export function fetchUsage(year: number, month: number, force = false): Promise<UsageResult> {
  return dsmApi<UsageResult>('/dsm/api/usage', { method: 'POST', body: JSON.stringify({ year, month, force }) })
}

/** The persisted preferences. */
export function fetchPrefs(): Promise<MonitorPrefs> {
  return dsmApi<MonitorPrefs>('/dsm/api/prefs')
}

/** Merge a prefs patch (validated host-side; interval floors at 60s). */
export function postPrefs(patch: Partial<MonitorPrefs>): Promise<MonitorPrefs> {
  return dsmApi<MonitorPrefs>('/dsm/api/prefs', { method: 'POST', body: JSON.stringify(patch) })
}

/** Clear the data cache or force-refresh everything now (重载缓存). */
export function postCache(action: 'clear' | 'refresh'): Promise<{ cleared?: boolean, refreshed?: boolean }> {
  return dsmApi('/dsm/api/cache', { method: 'POST', body: JSON.stringify({ action }) })
}
