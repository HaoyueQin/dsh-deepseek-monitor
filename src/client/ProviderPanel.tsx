/**
 * The expanded monitoring panel inside the DeepSeek provider row. The LAYOUT
 * mirrors DeepSeekMonitorWindows' dashboard structure —balance card with
 * today/month mini-metrics, one usage row per model (progress bar + cache-hit
 * rate + cost), the daily stacked cache-bar chart with week-style navigation
 * and legend, then token configuration and settings —while the CHROME stays
 * native to dsh: inline styles only, semantic tokens with fallbacks, host
 * font inheritance. Chart palette is DSM's own (hit green / miss orange /
 * response purple; flash blue / pro magenta), theme-aware via
 * prefers-color-scheme.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import Zap from 'lucide-react/dist/esm/icons/zap'
import Brain from 'lucide-react/dist/esm/icons/brain'
import ImageIcon from 'lucide-react/dist/esm/icons/image'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles'
import type { DeepSeekMonitorKey } from './locales.ts'
import { currencySymbol } from './balance-format.ts'
import { fetchBalance, fetchPrefs, fetchStatus, fetchUsage, postCache, postPrefs, postToken } from './api.ts'
import { CAPTURE_SCRIPT } from './capture-script.ts'
import type { MonitorPrefs, MonitorStatus, UsageModelSummary, UsageResult } from '../wire.ts'

export interface ProviderPanelProps {
  /** Active dictionary (resolved by the augment engine per locale). */
  d: Record<DeepSeekMonitorKey, string>
}

type Notice = { kind: 'ok' | 'error', text: string } | null

//  DSM chart palette (theme-aware) 

/** Chart palette —DSM's own, used ONLY by the stacked bars/legend. */
interface ChartPalette {
  hit: string
  miss: string
  response: string
}

const DARK_PALETTE: ChartPalette = {
  hit: '#34d399',
  miss: '#ff9c2b',
  response: '#a78bfa',
}

const LIGHT_PALETTE: ChartPalette = {
  hit: '#10b981',
  miss: '#ef8400',
  response: '#8b5cf6',
}

function useChartPalette(): ChartPalette {
  const [dark, setDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia !== undefined
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true)
  useEffect(() => {
    if (window.matchMedia === undefined) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent): void => { setDark(event.matches) }
    query.addEventListener('change', listener)
    return () => { query.removeEventListener('change', listener) }
  }, [])
  return dark ? DARK_PALETTE : LIGHT_PALETTE
}

//  Brand chrome 
// Pro carries the DeepSeek brand blue; Flash / Vision get soft cool companions
// so the three rows read as one coordinated family. Chart segments keep DSM's
// palette exclusively.

const BRAND_BLUE = '#4D6BFE'
const BRAND_BLUE_TINT = 'rgba(77, 107, 254, 0.14)'
const INK = 'var(--dsw-alias-fg, #16181d)'
const INK_TINT = 'color-mix(in srgb, var(--dsw-alias-fg, #16181d) 10%, transparent)'

export interface RowAccent {
  accent: string
  badgeBg: string
  gradient: string
}

/** Per-model row accents (soft cool family around the brand blue). */
const ROW_ACCENTS: Record<string, RowAccent> = {
  flash: {
    accent: '#4DA6FF',
    badgeBg: 'rgba(77, 166, 255, 0.15)',
    gradient: 'linear-gradient(90deg, #4DA6FF, #8FC6FF)',
  },
  'flash-vision': {
    accent: '#8F7DF0',
    badgeBg: 'rgba(143, 125, 240, 0.15)',
    gradient: 'linear-gradient(90deg, #8F7DF0, #C0B3FF)',
  },
  pro: {
    accent: BRAND_BLUE,
    badgeBg: BRAND_BLUE_TINT,
    gradient: 'linear-gradient(90deg, #4D6BFE, #8093FF)',
  },
}

/** Neutral fallback for unknown models. */
const INK_ACCENT: RowAccent = { accent: INK, badgeBg: INK_TINT, gradient: 'linear-gradient(90deg, #23262b, #565b64)' }

function rowAccent(key: string | undefined): RowAccent {
  if (key === undefined || key === null) return INK_ACCENT
  return ROW_ACCENTS[key] ?? INK_ACCENT
}

//  Formatting helpers (DSM utils equivalents) 

const fmtInt = (n: number): string => Math.round(n).toLocaleString()
const fmtTokensShort = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}K`
  return `${Math.round(n / 100_000) / 10}M`
}
const fmtMoney = (n: number, symbol = '¥'): string => `${symbol}${n.toFixed(2)}`
const todayStr = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

//  Shared chrome styles 

const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))',
  borderRadius: 10,
  padding: '12px 14px',
  background: 'var(--dsw-alias-bg-subtle, transparent)',
  boxSizing: 'border-box',
  minWidth: 0,
}
const captionRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }
const caption: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-fg-muted, var(--dsw-alias-label-tertiary, #888))' }
const mutedText: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-fg-muted, var(--dsw-alias-label-tertiary, #888))' }
const errorText: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-danger-fg, #c0392b)' }
const okText: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-success-fg, #1a7f37)' }
const buttonStyle: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))',
  background: 'transparent',
  color: 'var(--dsw-alias-fg, inherit)',
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 12,
  cursor: 'pointer',
}
const navButton: CSSProperties = { ...buttonStyle, padding: '0 8px', lineHeight: '20px' }

/**
 * Button-press feedback ON the button itself: dim on hover, sink + darken
 * while pressed (inline-style safe —no pseudo-class availability here).
 * Spread onto every actionable button.
 */
const pressFeedback = {
  onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (!event.currentTarget.disabled) event.currentTarget.style.opacity = '0.88'
  },
  onMouseLeave: (event: React.MouseEvent<HTMLButtonElement>): void => {
    const el = event.currentTarget
    el.style.opacity = ''
    el.style.transform = ''
    el.style.filter = ''
  },
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (!event.currentTarget.disabled) {
      event.currentTarget.style.transform = 'translateY(1px)'
      event.currentTarget.style.filter = 'brightness(0.85)'
    }
  },
  onMouseUp: (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.currentTarget.style.transform = ''
    event.currentTarget.style.filter = ''
  },
}

export function ProviderPanel({ d }: ProviderPanelProps): ReactNode {
  const palette = useChartPalette()
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [balanceError, setBalanceError] = useState('')
  const [monthOffset, setMonthOffset] = useState(0)
  const [usage, setUsage] = useState<UsageResult | null>(null)
  const [usageError, setUsageError] = useState('')
  const [prefs, setPrefs] = useState<MonitorPrefs | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [intervalDraft, setIntervalDraft] = useState('')
  const [thresholdDraft, setThresholdDraft] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  /** Auto-clear a transient ok notice so buttons always visibly acknowledge. */
  const flashNotice = useCallback((text: string): void => {
    setNotice({ kind: 'ok', text })
    window.setTimeout(() => { setNotice(current => (current !== null && current.text === text ? null : current)) }, 2000)
  }, [])

  const loadStatus = useCallback((): void => {
    void fetchStatus()
      .then((value) => { setStatus(value); setBalanceError(value.lastError ?? '') })
      .catch((error: unknown) => { setBalanceError(error instanceof Error ? error.message : String(error)) })
  }, [])

  useEffect(() => {
    loadStatus()
    void fetchPrefs().then((value) => {
      setPrefs(value)
      setIntervalDraft(String(value.refreshIntervalSeconds))
      setThresholdDraft(String(value.lowBalanceThreshold))
    }).catch(() => { /* settings card shows defaults */ })
  }, [loadStatus])

  // Keep the open panel fresh: poll the HOST CACHE at the configured refresh
  // interval (status reads never touch the upstream API — the refresher owns
  // that cadence). Without this the expanded card froze at its mount-time
  // snapshot while the chip and the stats band kept updating.
  useEffect(() => {
    const seconds = prefs?.refreshIntervalSeconds
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return
    const id = window.setInterval(() => { loadStatus() }, Math.max(60, seconds) * 1000)
    return () => { window.clearInterval(id) }
  }, [prefs?.refreshIntervalSeconds, loadStatus])

  // Month target for the usage card (0 = current month).
  const target = new Date()
  target.setDate(1)
  target.setMonth(target.getMonth() - monthOffset)
  const year = target.getFullYear()
  const month = target.getMonth() + 1

  useEffect(() => {
    if ((status?.platformToken.configured ?? false) !== true) return
    let disposed = false
    setUsageError('')
    void fetchUsage(year, month)
      .then((value) => { if (!disposed) setUsage(value) })
      .catch((error: unknown) => { if (!disposed) { setUsage(null); setUsageError(error instanceof Error ? error.message : String(error)) } })
    return () => { disposed = true }
  }, [year, month, status?.platformToken.configured])

  const refreshBalance = (): void => {
    setBusy(true); setNotice(null); setBalanceError('')
    void fetchBalance()
      .then(() => { loadStatus(); setNotice({ kind: 'ok', text: d.refreshedBalance }) })
      .catch((error: unknown) => { setBalanceError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { setBusy(false) })
  }

  const saveToken = (): void => {
    if (tokenInput.trim() === '') return
    setBusy(true); setNotice(null)
    void postToken('set', tokenInput.trim())
      .then(() => {
        setTokenInput(''); setNotice({ kind: 'ok', text: d.saveOk }); loadStatus()
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) })
      .finally(() => { setBusy(false) })
  }

  const clearToken = (): void => {
    setBusy(true); setNotice(null)
    void postToken('clear')
      .then(() => { setUsage(null); loadStatus(); setNotice({ kind: 'ok', text: d.tokenCleared }) })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) })
      .finally(() => { setBusy(false) })
  }

  const updatePref = (patch: Partial<MonitorPrefs>): void => {
    setBusy(true)
    void postPrefs(patch)
      .then((next) => {
        setPrefs(next)
        // Resync the drafts to the VALIDATED values (the host clamps the
        // interval to ≥60s); keeping the raw text would show "30" while 60
        // was saved.
        setIntervalDraft(String(next.refreshIntervalSeconds))
        setThresholdDraft(String(next.lowBalanceThreshold))
        flashNotice(d.saved)
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) })
      .finally(() => { setBusy(false) })
  }

  const cacheAction = (action: 'clear' | 'refresh'): void => {
    setBusy(true); setNotice(null); setBalanceError('')
    void postCache(action)
      .then(() => {
        setNotice({ kind: 'ok', text: action === 'clear' ? d.cacheCleared : d.reloaded })
        loadStatus()
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) })
      .finally(() => { setBusy(false) })
  }

  const balance = status?.balance ?? null
  const tokenOn = status?.platformToken.configured ?? false
  const keyOn = status?.apiKey.configured ?? false
  // Costs follow the ACCOUNT currency the balance snapshot names (a USD
  // account shows $ amounts); without a snapshot there is no fact to lean on
  // and the display falls back to the platform's billing default ¥.
  const costSymbol = balance !== null ? currencySymbol(balance.currency) : '¥'

  // Derived month facts (DSM DashboardPanel fold). ONLY the retired legacy
  // pair is filtered —every other model the platform reports renders (the
  // current lineup is Flash / Flash Vision / Pro), zero usage included.
  // Display order is fixed: Flash → Flash Vision → Pro → anything else.
  const LEGACY_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner', 'deepseek-chat & deepseek-reasoner'])
  const ROW_ORDER = new Map([['flash', 0], ['flash-vision', 1], ['pro', 2]])
  const allModels = usage?.models ?? []
  const rowModels: UsageModelSummary[] = allModels
    .filter(m => !LEGACY_MODELS.has(m.name) && !LEGACY_MODELS.has(m.key))
    .sort((a, b) => (ROW_ORDER.get(a.key) ?? 99) - (ROW_ORDER.get(b.key) ?? 99) || a.name.localeCompare(b.name))
  const maxTokens = Math.max(...rowModels.map(m => m.totalTokens), 1)
  const today = usage?.days.find(day => day.date === todayStr()) ?? null
  const monthTotal = usage?.days.reduce((sum, day) => sum + day.totalTokens, 0) ?? 0

  // Chart points (DSM UsageChart fold): hit/miss/response summed across ALL
  // models — flash/pro rows plus the other-model buckets, so a segment stack
  // always fills the bar height its total implies.
  const points = (usage?.days ?? []).map((day) => ({
    date: day.date,
    hit: day.flashCacheHit + day.proCacheHit + (day.otherCacheHit ?? 0),
    miss: day.flashCacheMiss + day.proCacheMiss + (day.otherCacheMiss ?? 0),
    response: day.flashResponse + day.proResponse + (day.otherResponse ?? 0),
    total: day.totalTokens,
    cost: day.totalCost,
  }))
  const maxVal = Math.max(...points.map(p => p.total), 1)
  const sumHit = points.reduce((s, p) => s + p.hit, 0)
  const sumMiss = points.reduce((s, p) => s + p.miss, 0)
  const hitRate = sumHit + sumMiss > 0 ? ((sumHit / (sumHit + sumMiss)) * 100).toFixed(1) : '—'

  // Sparse date labels, overlap-free by construction: uniform step of
  // ceil(N/7) slots (~7 labels for any month length); the last day joins only
  // when it keeps at least half a step from the previous label. Labels show
  // the bare day number (~14px), so even a 2-slot gap cannot collide.
  const labelStep = Math.max(3, Math.ceil(points.length / 7))
  const isLabeledIdx = (idx: number): boolean =>
    idx === 0 || idx === points.length - 1
    || (idx % labelStep === 0 && (points.length - 1 - idx) >= Math.ceil(labelStep / 2))

  /** Model badge icon —lucide only, matched to the model's character. */
  const modelIcon = (name: string, size = 16): ReactNode => {
    const common = { size, strokeWidth: 2 }
    const lower = name.toLowerCase()
    if (lower.includes('vision') || lower.includes('image')) return <ImageIcon {...common} />
    if (lower.includes('pro') || lower.includes('reasoner')) return <Brain {...common} />
    if (lower.includes('flash')) return <Zap {...common} />
    return <Sparkles {...common} />
  }

  const usageRow = (model: UsageModelSummary): ReactNode => {
    const accentSet = rowAccent(model.key)
    return (
      <div style={{ ...cardStyle, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
          background: accentSet.badgeBg, color: accentSet.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{modelIcon(model.name, 17)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{model.name}</span>
            <span style={mutedText}>{`${fmtInt(model.totalTokens)} tokens`}</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--dsw-alias-border-muted, rgba(127,127,127,0.18))', marginTop: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, background: accentSet.gradient,
              width: `${Math.max(2, (model.totalTokens / maxTokens) * 100)}%`,
            }} />
          </div>
          <span style={{ ...mutedText, color: accentSet.accent }}>
            {`${d.colCacheHit} ${model.cacheHitTokens + model.cacheMissTokens > 0 ? `${((model.cacheHitTokens / (model.cacheHitTokens + model.cacheMissTokens)) * 100).toFixed(1)}%` : '—'}`}
          </span>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{fmtMoney(model.cost, costSymbol)}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, marginTop: 10 }} data-dsm-panel="">

      {/*  Balance card  */}
      <div style={cardStyle}>
        <div style={captionRow}>
          <span style={caption}>{d.balanceTitle}</span>
          {keyOn && balance !== null
            ? (
                <span style={{
                  fontSize: 11, padding: '1px 8px', borderRadius: 999,
                  border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))',
                  color: balance.isAvailable ? okText.color : errorText.color,
                }}>{balance.isAvailable ? d.balanceAvailable : d.balanceInsufficient}</span>
              )
            : null}
          <button
            type="button"
            style={{ ...navButton, marginLeft: 'auto', opacity: busy ? 0.5 : 1 }}
            {...pressFeedback}
            disabled={busy || !keyOn}
            onClick={refreshBalance}
            title={d.refresh}
          >
            {busy ? '…' : '⟳'}
          </button>
        </div>
        {keyOn
          ? (
              <>
                <div style={{ fontSize: 26, fontWeight: 700, ...(status?.lowBalance === true ? errorText : {}) }}>
                  {/* Currency-aware: the API may serve USD-first accounts, and a
                      hardcoded ¥ mislabeled them (chip/band were already correct). */}
                  {balance !== null ? `${currencySymbol(balance.currency)}${balance.totalBalance}` : '—'}
                </div>
                {balance !== null
                  ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <div style={{ border: '1px solid var(--dsw-alias-border-muted, rgba(127,127,127,0.18))', borderRadius: 8, padding: '6px 10px' }}>
                          <div style={mutedText}>{d.todayCost}</div>
                          <div style={{ fontWeight: 600 }}>{today !== null ? fmtMoney(today.totalCost, costSymbol) : `${costSymbol}0.00`}</div>
                        </div>
                        <div style={{ border: '1px solid var(--dsw-alias-border-muted, rgba(127,127,127,0.18))', borderRadius: 8, padding: '6px 10px' }}>
                          <div style={mutedText}>{d.monthCostLabel}</div>
                          <div style={{ fontWeight: 600 }}>{usage !== null ? fmtMoney(usage.monthCost, costSymbol) : '—'}</div>
                        </div>
                      </div>
                    )
                  : null}
                {balance !== null
                  ? (
                      <div style={{ ...mutedText, marginTop: 6 }}>
                        {`${d.grantedBalance} ${currencySymbol(balance.currency)}${balance.grantedBalance} · ${d.toppedUpBalance} ${currencySymbol(balance.currency)}${balance.toppedUpBalance} · ${d.refreshedAt} ${new Date(balance.fetchedAt).toLocaleTimeString()}`}
                      </div>
                    )
                  : null}
                {balanceError !== '' ? <div style={{ ...errorText, marginTop: 6 }}>{balanceError}</div> : null}
                {status?.lowBalance === true ? <div style={{ ...errorText, marginTop: 6 }}>{d.lowBalanceWarn}</div> : null}
              </>
            )
            : <div style={errorText}>{d.keyNotConfigured}</div>}
      </div>

      {/*  Usage rows (per model)  */}
      {!tokenOn || usage === null
        ? null
        : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rowModels.map(model => (
                <div key={model.key}>{usageRow(model)}</div>
              ))}
            </div>
          )}

      {/*  Daily stacked chart  */}
      <div style={cardStyle}>
        <div style={captionRow}>
          <span style={caption}>{d.monthUsage}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button type="button" style={navButton} {...pressFeedback} onClick={() => { setMonthOffset(o => o + 1) }}>‹</button>
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 58, textAlign: 'center' }}>{`${year}-${String(month).padStart(2, '0')}`}</span>
            <button type="button" style={navButton} {...pressFeedback} disabled={monthOffset <= 0} onClick={() => { setMonthOffset(o => Math.max(0, o - 1)) }}>›</button>
          </span>
        </div>
        {!tokenOn
          ? <div style={mutedText}>{d.noTokenHint}</div>
          : usageError !== ''
            ? <div style={errorText}>{usageError}</div>
            : usage === null
              ? <div style={mutedText}>…</div>
              : points.length === 0
                ? <div style={mutedText}>{d.noUsageData}</div>
                : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, height: 120 }}>
                        {points.map((point, idx) => {
                          const heightPct = point.total > 0 ? Math.max(3, (point.total / maxVal) * 100) : 3
                          const dayNum = Number.parseInt(point.date.slice(8), 10)
                          const showLabel = isLabeledIdx(idx)
                          const hovered = hoveredIdx === idx
                          const tooltipAlign: CSSProperties = idx <= 1
                            ? { left: 0 }
                            : idx >= points.length - 2
                              ? { right: 0 }
                              : { left: '50%', transform: 'translateX(-50%)' }
                          return (
                            <div
                              key={point.date}
                              style={{
                                flex: 1, minWidth: 6, height: '100%',
                                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                                alignItems: 'center', gap: 4,
                                position: 'relative',
                              }}
                              onMouseEnter={() => { setHoveredIdx(idx) }}
                              onMouseLeave={() => { setHoveredIdx(null) }}
                            >
                              {hovered
                                ? (
                                    <div style={{
                                      position: 'absolute', bottom: 'calc(100% + 6px)', zIndex: 5,
                                      minWidth: 150, whiteSpace: 'nowrap',
                                      background: 'var(--dsw-alias-overlay-bg, rgba(20,22,26,0.92))',
                                      color: 'var(--dsw-alias-overlay-fg, #f2f3f5)',
                                      borderRadius: 8, padding: '8px 10px',
                                      boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
                                      fontSize: 11, lineHeight: 1.6,
                                      ...tooltipAlign,
                                    }}>
                                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{point.date} · {fmtInt(point.total)} tokens</div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <i style={{ width: 7, height: 7, borderRadius: 999, background: palette.hit, display: 'inline-block' }} />
                                        {`${d.legendHit} ${fmtInt(point.hit)}`}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <i style={{ width: 7, height: 7, borderRadius: 999, background: palette.miss, display: 'inline-block' }} />
                                        {`${d.legendMiss} ${fmtInt(point.miss)}`}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <i style={{ width: 7, height: 7, borderRadius: 999, background: palette.response, display: 'inline-block' }} />
                                        {`${d.legendOutput} ${fmtInt(point.response)}`}
                                      </div>
                                      <div style={{ marginTop: 3, paddingTop: 3, borderTop: '1px solid rgba(127,127,127,0.25)' }}>
                                        {`${d.colCacheHit} ${point.hit + point.miss > 0 ? ((point.hit / (point.hit + point.miss)) * 100).toFixed(1) : '—'}% · ${d.colCost} ${costSymbol}${point.cost.toFixed(2)}`}
                                      </div>
                                    </div>
                                  )
                                : null}
                              <div style={{
                                width: '100%', maxWidth: 30,
                                height: point.total > 0 ? `${heightPct}%` : 3,
                                display: 'flex', flexDirection: 'column-reverse',
                                borderRadius: 3, overflow: 'hidden',
                                background: point.total > 0 ? 'transparent' : 'var(--dsw-alias-border-muted, rgba(127,127,127,0.14))',
                                transition: 'height 120ms ease',
                              }}>
                                {point.hit > 0 ? <i style={{ background: palette.hit, flexGrow: point.hit }} /> : null}
                                {point.miss > 0 ? <i style={{ background: palette.miss, flexGrow: point.miss }} /> : null}
                                {point.response > 0 ? <i style={{ background: palette.response, flexGrow: point.response }} /> : null}
                              </div>
                              <span style={{
                                fontSize: 10,
                                color: hovered ? 'var(--dsw-alias-fg, inherit)' : 'var(--dsw-alias-fg-muted, var(--dsw-alias-label-tertiary, #888))',
                              }}>{showLabel ? String(dayNum) : '·'}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                        <span style={mutedText}>
                          {`${hitRate}% · ${monthTotal > 0 ? fmtTokensShort(monthTotal) : '—'}${usage.monthCost > 0 ? ` · ${costSymbol}${usage.monthCost.toFixed(2)}` : ''}`}
                        </span>
                        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                          {([['legendHit', palette.hit], ['legendMiss', palette.miss], ['legendOutput', palette.response]] as const).map(([key, color]) => (
                            <span key={key} style={{ ...mutedText, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <i style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }} />
                              {d[key]}
                            </span>
                          ))}
                        </span>
                      </div>
                    </>
                  )}
      </div>

      {/*  Platform token  */}
      <div style={cardStyle}>
        <div style={captionRow}>
          <span style={caption}>{d.tokenTitle}</span>
          <span style={tokenOn ? okText : mutedText}>{tokenOn ? d.tokenConfigured : d.tokenNotSet}</span>
        </div>
        <p style={{ margin: '0 0 8px', ...S_desc }}>{d.tokenDesc}</p>
        <input
          type="password"
          placeholder={d.tokenPlaceholder}
          value={tokenInput}
          onChange={(event) => { setTokenInput(event.target.value) }}
          style={{
            width: '100%', boxSizing: 'border-box', marginBottom: 8,
            border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))',
            borderRadius: 6, background: 'var(--dsw-alias-bg-canvas, transparent)',
            color: 'var(--dsw-alias-fg, inherit)', padding: '6px 10px', fontSize: 12,
          }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">
            <button type="button" style={buttonStyle} {...pressFeedback}>{d.openPlatform}</button>
          </a>
          <button
            type="button"
            style={buttonStyle}
            disabled={busy}
            onClick={() => {
              void navigator.clipboard.writeText(CAPTURE_SCRIPT)
                .then(() => { flashNotice(d.scriptCopied) })
                .catch(() => { setNotice({ kind: 'error', text: d.opFailed }) })
            }}
          >
            {d.copyScript}
          </button>
          <button type="button" style={buttonStyle} disabled={busy || tokenInput.trim() === ''} onClick={saveToken}>
            {d.tokenSave}
          </button>
          {tokenOn
            ? (
                <button type="button" style={buttonStyle} disabled={busy} onClick={clearToken}>
                  {d.tokenClear}
                </button>
              )
            : null}
        </div>
      </div>

      {/*  Settings  */}
      <div style={cardStyle}>
        <div style={captionRow}><span style={caption}>{d.settingsTitle}</span></div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', ...mutedText }}>
            <input
              type="checkbox"
              checked={prefs?.autoRefreshEnabled ?? true}
              onChange={(event) => { updatePref({ autoRefreshEnabled: event.target.checked }) }}
            />
            {d.autoRefresh}
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...mutedText }}>
            {d.refreshInterval}
            <input
              type="number"
              min={60}
              step={30}
              value={intervalDraft}
              onChange={(event) => { setIntervalDraft(event.target.value) }}
              onBlur={() => {
                const value = Number.parseInt(intervalDraft, 10)
                if (Number.isFinite(value) && prefs !== null && value !== prefs.refreshIntervalSeconds) updatePref({ refreshIntervalSeconds: value })
              }}
              style={{ width: 70, border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))', borderRadius: 6, background: 'var(--dsw-alias-bg-canvas, transparent)', color: 'var(--dsw-alias-fg, inherit)', padding: '3px 6px', fontSize: 12 }}
            />
            {d.secondsUnit}
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', ...mutedText }}>
            <input
              type="checkbox"
              checked={prefs?.lowBalanceNotify ?? false}
              onChange={(event) => { updatePref({ lowBalanceNotify: event.target.checked }) }}
            />
            {d.lowBalanceAlert}
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...mutedText }}>
            {d.lowBalanceThreshold}
            <input
              type="number"
              min={0}
              step={1}
              value={thresholdDraft}
              onChange={(event) => { setThresholdDraft(event.target.value) }}
              onBlur={() => {
                const value = Number.parseFloat(thresholdDraft)
                if (Number.isFinite(value) && prefs !== null && value !== prefs.lowBalanceThreshold) updatePref({ lowBalanceThreshold: value })
              }}
              style={{ width: 64, border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))', borderRadius: 6, background: 'var(--dsw-alias-bg-canvas, transparent)', color: 'var(--dsw-alias-fg, inherit)', padding: '3px 6px', fontSize: 12 }}
            />
          </label>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => { cacheAction('refresh') }}>
            {d.reloadCache}
          </button>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => { cacheAction('clear') }}>
            {d.clearCache}
          </button>
        </div>
      </div>

      {notice !== null && notice.text !== ''
        ? <div style={notice.kind === 'ok' ? okText : errorText}>{`${notice.kind === 'ok' ? '' : `${d.opFailed}: `}${notice.text}`}</div>
        : null}
    </div>
  )
}

// Local desc alias kept tiny for the two paragraphs above.
const S_desc: CSSProperties = { fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-fg-muted, var(--dsw-alias-label-tertiary, #888))' }
