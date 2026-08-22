/**
 * The conversation stats-band balance integration.
 *
 * Architecture: this slot component is an INVISIBLE ANCHOR — the official
 * `conversation.composer.dock` seat gives it session identity and lifecycle,
 * but it renders nothing visible. The visible 「｜ 余额 …」 group is appended
 * directly INTO the shipped StatsLine's text flow (previous sibling), so it
 * can never overlap the other groups: it participates in their centering and
 * ellipsis like any trailing group. The host's React re-renders may wipe the
 * appended node; a MutationObserver re-appends on the next frame, so the
 * group self-heals.
 *
 * Display policy (all must hold): stats row present · session's latest route
 * is an official DeepSeek model · monitor service alive.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { en } from './locales.ts'
import { LOCALE_NS } from './locales.ts'
import { fetchSessionRoute, fetchStatus } from './api.ts'
import type { MonitorStatus } from '../wire.ts'

export type BalanceDockProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<typeof LOCALE_NS>

const POLL_MS = 60_000

/** Whether a route names an official DeepSeek model. */
export function isOfficialDeepSeek(route: { provider: string, model: string } | null | undefined): boolean {
  if (route === undefined || route === null) return false
  return route.model.toLowerCase().startsWith('deepseek')
    || route.provider === 'deepseek'
    || route.provider === 'llm-deepseek'
}

export function BalanceDock(props: BalanceDockProps): ReactNode {
  const t = props.t as ((key: keyof typeof en) => string) | undefined
  const [alive, setAlive] = useState<boolean | null>(null)
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [route, setRoute] = useState<{ provider: string, model: string } | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let disposed = false
    const sessionId = props.sessionId === undefined ? undefined : String(props.sessionId)
    const poll = (): void => {
      void fetchStatus()
        .then((value) => { if (!disposed) { setStatus(value); setAlive(true) } })
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

  // Band integration: keep the appended group in sync with gates + data.
  useEffect(() => {
    const t0 = props.t as ((key: keyof typeof en) => string) | undefined
    if (t0 === undefined) return
    let raf = 0
    const ensure = (): void => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const prev = anchor.previousElementSibling as HTMLElement | null
      const hasStats = prev !== null && (prev.textContent?.trim().length ?? 0) > 0
      const visible = hasStats && alive === true && isOfficialDeepSeek(route)
      const existing = prev?.querySelector<HTMLElement>('[data-dsm-band]') ?? null
      if (!visible || prev === null) {
        existing?.remove()
        return
      }
      let band = existing
      if (band === null) {
        band = document.createElement('span')
        band.setAttribute('data-dsm-band', '')
        const sep = document.createElement('span')
        sep.setAttribute('aria-hidden', '')
        sep.textContent = '|'
        sep.style.cssText = 'margin:0 10px;color:var(--dsw-alias-separator-primary,#bbb)'
        const value = document.createElement('span')
        band.append(sep, value)
      }
      const valueEl = band.lastElementChild as HTMLElement
      const b = status?.balance ?? null
      const low = status?.lowBalance === true
      valueEl.textContent = b !== null ? `${b.totalBalance} ${b.currency}` : '--'
      valueEl.style.color = low ? 'var(--dsw-alias-danger-fg, #c0392b)' : ''
      band.title = `${t0('balanceLabel')}: ${valueEl.textContent}`
      // Re-append only when detached or misplaced (React wipes/reorders).
      if (band.parentElement !== prev) prev.appendChild(band)
    }
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(ensure)
    }
    ensure()
    const observer = new MutationObserver(schedule)
    const bindPrev = (): void => {
      const anchor = anchorRef.current
      const prev = anchor?.previousElementSibling ?? null
      if (prev !== null) observer.observe(prev, { childList: true, characterData: true, subtree: true })
    }
    bindPrev()
    if (anchorRef.current?.parentElement !== null && anchorRef.current?.parentElement !== undefined) {
      observer.observe(anchorRef.current.parentElement, { childList: true })
    }
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      // Fiber disposal removes our node with the row.
      anchorRef.current?.previousElementSibling?.querySelector('[data-dsm-band]')?.remove()
    }
  }, [alive, status, route, props.sessionId, props.t])

  // Invisible anchor: session identity + lifecycle + a stable previousSibling
  // locator for the band integrator above.
  return (
    <span
      ref={anchorRef}
      data-dsm-dock=""
      data-dsm-alive={alive === null ? 'pending' : String(alive)}
      data-dsm-provider={route?.provider ?? ''}
      data-dsm-model={route?.model ?? ''}
      style={{ display: 'none' }}
    />
  )
}
