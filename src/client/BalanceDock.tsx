/**
 * The conversation stats-band balance integration.
 *
 * Architecture: this slot component is an INVISIBLE ANCHOR — the official
 * `conversation.composer.dock` seat gives it session identity and lifecycle,
 * but it renders nothing visible. The visible 「｜ 余额 …」 group OVERLAYS the
 * shipped StatsLine's right edge (absolutely positioned inside it), so its
 * placement can never drift: the host line is a centered nowrap TEXT block,
 * and a node injected into its inline flow gets shuffled by React
 * reconciliation — observed left, right, AND mid-line across re-renders. An
 * absolutely positioned box ignores sibling order entirely. The host root's
 * right padding is grown by the band's measured width so the centered text
 * keeps its ellipsis behaviour and never slides under the overlay.
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

  // Band integration: keep the overlay pinned to the stats row's right edge,
  // in sync with gates + data.
  useEffect(() => {
    const t0 = props.t as ((key: keyof typeof en) => string) | undefined
    if (t0 === undefined) return
    let raf = 0
    /** Release the reserved padding / positioning we put on the host row.
     *  Accepts null/undefined BY DESIGN: at cleanup time React may already
     *  have detached/null the anchor, and a throw here escapes the effect
     *  boundary — which retires the WHOLE conversation slot entry (observed:
     *  blank center pane until reload). */
    const releaseRow = (row: HTMLElement | null | undefined): void => {
      if (row === null || row === undefined) return
      if (row.dataset.dsmBandPad !== undefined) {
        delete row.dataset.dsmBandPad
        row.style.paddingRight = ''
      }
      if (row.dataset.dsmBandRel === '1') {
        delete row.dataset.dsmBandRel
        row.style.position = ''
      }
    }
    const applyBand = (): void => {
      const anchor = anchorRef.current
      if (anchor === null) return
      // ?? null: previousElementSibling is Element | null per the DOM types,
      // but a detached anchor can yield undefined through optional chaining —
      // normalize so every guard below only ever sees null.
      const row = (anchor.previousElementSibling ?? null) as HTMLElement | null
      const hasStats = row !== null && statsTextLength(row) > 0
      const existing = row?.querySelector<HTMLElement>('[data-dsm-band]') ?? null
      const visible = hasStats && row !== null && alive === true && isOfficialDeepSeek(route)
      if (!visible || row === null) {
        existing?.remove()
        if (row !== null) releaseRow(row)
        return
      }
      // One-time positioning setup: the host root is static; our overlay
      // needs it as the containing block. Both flags make the additions
      // reversible without touching the host stylesheet.
      if (row.dataset.dsmBandRel === undefined && getComputedStyle(row).position === 'static') {
        row.dataset.dsmBandRel = '1'
        row.style.position = 'relative'
      }
      // Kill any stray band React reconciliation left elsewhere in the row.
      row.querySelectorAll('[data-dsm-band]').forEach((node) => {
        if (node !== existing) node.remove()
      })
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
        row.appendChild(band)
      }
      const valueEl = band.lastElementChild as HTMLElement
      const b = status?.balance ?? null
      const low = status?.lowBalance === true
      valueEl.textContent = b !== null ? formatBalance(b) : '--'
      valueEl.style.color = low ? 'var(--dsw-alias-danger-fg, #c0392b)' : ''
      band.title = `${t0('balanceLabel')}: ${valueEl.textContent}`
      // Pin RIGHT, deterministically: absolute overlay at the content-box
      // right edge (the row's own padding), vertically centred on the line.
      // Sibling order — whatever React does to its own children — cannot move it.
      const padR = Number.parseFloat(getComputedStyle(row).paddingRight) || 0
      band.style.cssText = `position:absolute;top:50%;transform:translateY(-50%);right:${padR}px;z-index:1;white-space:nowrap;line-height:inherit;`
      // Reserve the band's FULL measured width beyond the original padding:
      // the overlay's right edge sits at the original content edge and grows
      // leftward, so the centered text must ellipsize bandWidth earlier.
      const base = Number.parseFloat(row.dataset.dsmBandPad ?? String(padR))
      row.dataset.dsmBandPad = String(base)
      row.style.paddingRight = `${base + Math.max(band.offsetWidth, 0)}px`
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
      // Fiber disposal: drop our overlay and undo the row additions. The
      // anchor may already be detached (React nulls refs during unmount), so
      // normalize undefined AND contain any residual failure — a throw here
      // is what retired the conversation entry on session switches.
      try {
        const row = (anchorRef.current?.previousElementSibling ?? null) as HTMLElement | null
        row?.querySelector('[data-dsm-band]')?.remove()
        releaseRow(row)
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
