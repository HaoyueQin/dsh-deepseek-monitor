/**
 * The composer tool-row balance chip: the official `conversation.input.right`
 * seat, whose entries the host renders immediately LEFT of the model name
 * (InputBar's trailing group: rightItems → model select → context meter →
 * send). A real flex child of the trailing group — no absolute positioning,
 * no host-DOM injection, no geometry measurement — so it inherits the row's
 * 12px control gap and can never overlap its neighbors.
 *
 * Typography parity with the sibling model-select chip (28px height, 13px/20px
 * medium). Coloring policy: the currency symbol stays the neutral secondary
 * label color in both themes; the NUMBER alone turns green above zero
 * (`--dsw-alias-state-success-primary`) and red at or below zero
 * (`--dsw-alias-state-error-primary`).
 *
 * Display policy (all must hold): monitor service alive · session's latest
 * route is an official DeepSeek model · the locale seat is installed. The
 * hero screen (no session) renders no tool row at all, so the chip is
 * absent there by construction.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { en } from './locales.ts'
import { LOCALE_NS } from './locales.ts'
import { fetchSessionRoute, fetchStatus } from './api.ts'
import { currencySymbol } from './balance-format.ts'
import type { BalanceSnapshot } from '../wire.ts'

export type BalanceChipProps = PropsRuntime<'conversation.input.right'> & PropsLocale<typeof LOCALE_NS>

const POLL_MS = 60_000

/** Whether a route names an official DeepSeek model. */
export function isOfficialDeepSeek(route: { provider: string, model: string } | null | undefined): boolean {
  if (route === undefined || route === null) return false
  return route.model.toLowerCase().startsWith('deepseek')
    || route.provider === 'deepseek'
    || route.provider === 'deepseek-official'
    || route.provider === 'llm-deepseek'
}

/** Parse the verbatim upstream amount string; null when it is not a finite
 *  number (the upstream contract sends display strings, never exponents). */
export function parseAmount(total: string): number | null {
  const n = Number.parseFloat(total)
  return Number.isFinite(n) ? n : null
}

/** The number's color token: green above zero, red at or below. Null (no
 *  readable snapshot yet) keeps the neutral secondary color. */
export function amountTone(amount: number | null): 'positive' | 'nonpositive' | 'neutral' {
  if (amount === null) return 'neutral'
  return amount > 0 ? 'positive' : 'nonpositive'
}

const TONE_COLOR: Record<'positive' | 'nonpositive' | 'neutral', string> = {
  positive: 'var(--dsw-alias-state-success-primary)',
  nonpositive: 'var(--dsw-alias-state-error-primary)',
  neutral: 'var(--dsw-alias-label-secondary)',
}

export function BalanceChip(props: BalanceChipProps): ReactNode {
  const t = props.t as ((key: keyof typeof en) => string) | undefined
  const [alive, setAlive] = useState<boolean | null>(null)
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null)
  const [route, setRoute] = useState<{ provider: string, model: string } | null>(null)

  useEffect(() => {
    let disposed = false
    const sessionId = props.sessionId === undefined ? undefined : String(props.sessionId)
    const poll = (): void => {
      void fetchStatus()
        .then((value) => { if (!disposed) { setBalance(value.balance); setAlive(true) } })
        .catch(() => { if (!disposed) setAlive(false) })
      if (sessionId !== undefined) {
        void fetchSessionRoute(sessionId)
          .then((value) => { if (!disposed) setRoute(value) })
          .catch(() => { if (!disposed) setRoute(null) })
      }
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [props.sessionId])

  if (alive !== true || !isOfficialDeepSeek(route) || t === undefined) return null

  const amount = balance === null ? null : parseAmount(balance.totalBalance)
  const tone = amountTone(amount)
  // Narrow through `balance` itself: TS cannot infer the snapshot from the
  // parsed amount, so both guards live on the same expression.
  const valueText = balance === null || amount === null ? '--' : balance.totalBalance
  const symbol = balance === null ? '' : currencySymbol(balance.currency)

  return (
    <span
      data-dsm-composer-chip=""
      data-dsm-provider={route?.provider ?? ''}
      data-dsm-model={route?.model ?? ''}
      title={`${t('balanceLabel')}: ${symbol}${valueText}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flex: 'none',
        height: '28px',
        padding: '0 8px',
        borderRadius: '24px',
        fontSize: '13px',
        lineHeight: '20px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{symbol}</span>
      <span style={{ color: TONE_COLOR[tone], fontVariantNumeric: 'tabular-nums' }}>{valueText}</span>
    </span>
  )
}
