/**
 * The conversation stats-band balance integration.
 *
 * Architecture: this slot component is an INVISIBLE ANCHOR — the official
 * `conversation.composer.dock` seat gives it session identity and lifecycle,
 * but it renders nothing visible. The visible 「｜ 余额 …」 group joins the
 * shipped StatsLine's INLINE FLOW as its last child, so the balance reads
 * immediately after the host's stats groups in the same centered line and
 * typography. React reconciliation can shuffle or drop that foreign node
 * across re-renders; the mutation observer re-appends it within a frame and
 * removes any stray copy, so the observed mid-line drift self-corrects. (An
 * earlier absolutely-pinned version was deterministic but left a wide dead
 * gap between the centered text and the band on the row's right edge.)
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
import { formatBalance } from './balance-format.ts'
import type { MonitorStatus } from '../wire.ts'

export type BalanceDockProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<typeof LOCALE_NS>

const POLL_MS = 60_000

/** Whether a route names an official DeepSeek model. */
export function isOfficialDeepSeek(route: { provider: string, model: string } | null | undefined): boolean {
  if (route === undefined || route === null) return false
  return route.model.toLowerCase().startsWith('deepseek')
    || route.provider === 'deepseek'
    || route.provider === 'deepseek-official'
    || route.provider === 'llm-deepseek'
}

/** Visible text of the stats row EXCLUDING our own band (a leftover band
 *  would otherwise satisfy the hasStats gate forever after a React wipe). */
function statsTextLength(row: HTMLElement): number {
  let n = 0
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child instanceof HTMLElement && child.hasAttribute('data-dsm-band')) continue
      n += child.textContent?.length ?? 0
    }
  }
  walk(row)
  return n
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

  // Band integration: keep the in-flow band after the stats row's own text,
  // in sync with the gates + data.
  useEffect(() => {
    const t0 = props.t as ((key: keyof typeof en) => string) | undefined
    if (t0 === undefined) return
    let raf = 0
    const applyBand = (): void => {
      const anchor = anchorRef.current
      if (anchor === null) return
      // ?? null: previousElementSibling is Element | null per the DOM types,
      // but a detached anchor can yield undefined through optional chaining —
      // normalize so every guard below only ever sees null.
      const row = (anchor.previousElementSibling ?? null) as HTMLElement | null
      const hasStats = row !== null && statsTextLength(row) > 0
      const visible = hasStats && row !== null && alive === true && isOfficialDeepSeek(route)
      if (!visible || row === null) {
        row?.querySelectorAll('[data-dsm-band]').forEach((node) => { node.remove() })
        return
      }
      // Keep ONE band, and keep it as the row's LAST child: the host row is a
      // centered nowrap block, so an appended inline span renders immediately
      // after the host's stats groups in the same line and typography. React
      // reconciliation can move or drop the foreign node across re-renders —
      // move it back to the end and remove any stray copy it left behind.
      const candidates = row.querySelectorAll('[data-dsm-band]')
      let band: HTMLElement | null = candidates.length > 0 ? candidates[0] as HTMLElement : null
      for (const node of candidates) {
        if (node !== band) node.remove()
      }
      if (band === null) {
        band = document.createElement('span')
        band.setAttribute('data-dsm-band', '')
        const sep = document.createElement('span')
        sep.setAttribute('aria-hidden', '')
        sep.textContent = '|'
        sep.style.cssText = 'margin:0 10px;color:var(--dsw-alias-separator-primary,#bbb)'
        const value = document.createElement('span')
        value.setAttribute('data-dsm-band-value', '')
        band.append(sep, value)
        row.appendChild(band)
      } else if (band !== row.lastElementChild) {
        // React moved the band mid-line: move it back to the end.
        row.appendChild(band)
      }
      const valueEl = band.querySelector<HTMLElement>('[data-dsm-band-value]')
        ?? band.lastElementChild as HTMLElement
      const b = status?.balance ?? null
      const low = status?.lowBalance === true
      valueEl.textContent = b !== null ? formatBalance(b) : '--'
      valueEl.style.color = low ? 'var(--dsw-alias-danger-fg, #c0392b)' : ''
      band.title = `${t0('balanceLabel')}: ${valueEl.textContent}`
    }
    // Our integration must NEVER throw into the host slot: an escaping error
    // from an effect or its cleanup retires the conversation entry (the blank
    // center-pane incident). Contain everything here; the next scheduled pass
    // retries against whatever DOM state triggered the failure.
    const ensure = (): void => {
      try { applyBand() } catch { /* transient host DOM state */ }
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
      // Fiber disposal: drop every band we added. The anchor may already be
      // detached (React nulls refs during unmount), so normalize undefined
      // AND contain any residual failure — a throw here is what retired the
      // conversation entry on session switches.
      try {
        const row = (anchorRef.current?.previousElementSibling ?? null) as HTMLElement | null
        row?.querySelectorAll('[data-dsm-band]').forEach((node) => { node.remove() })
      } catch { /* never let disposal break the host slot */ }
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
