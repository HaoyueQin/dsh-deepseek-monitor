/**
 * The conversation stats-band balance integration.
 *
 * Architecture: this slot component is an INVISIBLE ANCHOR — the official
 * `conversation.composer.dock` seat gives it session identity and lifecycle,
 * but it renders nothing visible. The visible 「｜ 余额 …」 group is an
 * absolutely positioned child of the shipped StatsLine row (its containing
 * block), so React reconciliation over the row can shuffle but never un-anchor
 * it — the observer re-attaches it within a frame. Each pass measures the
 * host text with a Range that ends before the band: when text + band fit the
 * row, the band parks right after the text end (no dead gap between the last
 * stats group and the balance); on an overlong line it pins to the content
 * right edge and the row's right padding grows so the host ellipsis stops
 * left of the band — the balance stays visible either way.
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

  // Band integration: keep the band after the stats row's own text (or
  // pinned right when the line overflows), in sync with the gates + data.
  // Absolute geometry resolves against the row (position:relative marker).
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
      const parent = anchor.parentElement
      const hasStats = row !== null && statsTextLength(row) > 0
      const visible = hasStats && row !== null && parent !== null && alive === true && isOfficialDeepSeek(route)
      if (!visible) {
        row?.querySelectorAll('[data-dsm-band]').forEach((node) => { node.remove() })
        parent?.querySelectorAll('[data-dsm-band]').forEach((node) => { node.remove() })
        releaseRow(row)
        return
      }
      // The band lives INSIDE the row as an absolutely positioned child — an
      // absolute box resolves against its nearest positioned ANCESTOR, so a
      // sibling band could not use the row as its containing block. React
      // reconciliation may move or drop the foreign node; re-attach it to the
      // row and remove any stray copy below. The text Range explicitly ends
      // BEFORE the band, so the measurement always sees host text only.
      let band = row.querySelector<HTMLElement>('[data-dsm-band]')
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
      }
      if (band.parentElement !== row) row.appendChild(band)
      // Remove strays everywhere (a React-shuffled copy elsewhere in the row,
      // a leftover sibling from an older build).
      row.querySelectorAll('[data-dsm-band]').forEach((node) => { if (node !== band) node.remove() })
      parent.querySelectorAll('[data-dsm-band]').forEach((node) => { if (node !== band) node.remove() })
      const valueEl = band.querySelector<HTMLElement>('[data-dsm-band-value]')
        ?? band.lastElementChild as HTMLElement
      const b = status?.balance ?? null
      const low = status?.lowBalance === true
      valueEl.textContent = b !== null ? formatBalance(b) : '--'
      valueEl.style.color = low ? 'var(--dsw-alias-danger-fg, #c0392b)' : ''
      band.title = `${t0('balanceLabel')}: ${valueEl.textContent}`

      // The host root is static; the overlay needs it as the containing
      // block. The marker makes the addition reversible on disposal.
      if (row.dataset.dsmBandRel === undefined && getComputedStyle(row).position === 'static') {
        row.dataset.dsmBandRel = '1'
        row.style.position = 'relative'
      }

      // Measure the HOST text with a Range (full width even when the row
      // clips it with an ellipsis), then pick a posture:
      //  - text + band fit: park the band right after the text end, so no
      //    dead gap opens between the last stats group and the balance;
      //  - they do not fit: pin the band at the content right edge and grow
      //    the row's right padding by the band width so the ellipsis stops
      //    LEFT of the band — the balance stays visible on overlong lines.
      // The base padding is remembered in the row dataset: the pin uses the
      // ORIGINAL padding, never the grown one (re-reading the grown value
      // each pass would drift the band leftward on every tick).
      const base = Number.parseFloat(row.dataset.dsmBandPad ?? String(Number.parseFloat(getComputedStyle(row).paddingRight) || 0))
      const padL = Number.parseFloat(getComputedStyle(row).paddingLeft) || 0
      // The short-branch parking needs the text's TRUE centered position:
      // release any grown padding BEFORE measuring, or the text would still
      // be centered in the shrunk content box and the band would land on top
      // of the text end. The long branch re-grows it right after — both
      // writes happen inside one synchronous pass, so nothing flickers.
      if (row.style.paddingRight !== '') {
        row.style.paddingRight = ''
        delete row.dataset.dsmBandPad
      }
      const range = document.createRange()
      range.setStart(row, 0)
      range.setEndBefore(band)
      const textRect = range.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const contentWidth = Math.max(0, row.clientWidth - padL - base)
      const bandWidth = band.offsetWidth
      if (textRect.width + bandWidth <= contentWidth) {
        // left/right resolve against the row's BORDER box (verified against
        // the live DOM: moving the row moves the band 1:1 while padding
        // changes do not), so the offset is the text end minus the border
        // edge — no padding term. The separator's own 10px margin then
        // supplies the host-standard gap between the last glyph and the |.
        const left = textRect.left - rowRect.left + textRect.width
        band.style.cssText = `position:absolute;top:50%;transform:translateY(-50%);left:${left}px;white-space:nowrap;line-height:inherit;`
      } else {
        row.dataset.dsmBandPad = String(base)
        row.style.paddingRight = `${base + bandWidth}px`
        band.style.cssText = `position:absolute;top:50%;transform:translateY(-50%);right:${base}px;white-space:nowrap;line-height:inherit;`
      }
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
      // Fiber disposal: drop every band we added (row-scoped strays and the
      // sibling band alike) and undo the row additions. The anchor may already
      // be detached (React nulls refs during unmount), so normalize undefined
      // AND contain any residual failure — a throw here is what retired the
      // conversation entry on session switches.
      try {
        const row = (anchorRef.current?.previousElementSibling ?? null) as HTMLElement | null
        row?.querySelectorAll('[data-dsm-band]').forEach((node) => { node.remove() })
        anchorRef.current?.parentElement?.querySelectorAll('[data-dsm-band]').forEach((node) => { node.remove() })
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
