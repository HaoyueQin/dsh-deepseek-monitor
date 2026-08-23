/**
 * The DeepSeek provider-row augmentation engine: locates the Models page row
 * whose name is "DeepSeek" and mounts three pieces around it —
 *   ① a balance chip next to the row identity,
 *   ② a 「用量」 button LEFT of the row's 编辑 action,
 *   ③ an expandable panel container after the row head (portal target).
 * Anchors are structural-class substrings (`[class*="rowName"]`, the CSS
 * modules hash pattern `[hash]_[local]`) plus localized button text — never
 * full hashed class names. Everything carries a `data-dsm-*` marker, is
 * re-synced through a body-wide MutationObserver plus a slow safety interval,
 * and is fully removed on fiber disposal (HMR-safe).
 */

import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { ProviderPanel } from './ProviderPanel.tsx'
import { formatBalance } from './balance-format.ts'
import { fetchStatus } from './api.ts'
import type { MonitorStatus } from '../wire.ts'
import type { DeepSeekMonitorKey } from './locales.ts'

const CHIP = 'data-dsm-chip'
const BTN = 'data-dsm-btn'
const PANEL = 'data-dsm-panel-root'

/** Row-name texts that identify the official DeepSeek provider row. */
const ROW_NAMES = new Set(['DeepSeek'])
/** The edit-button labels the Models page uses per locale ('編輯' guards a
 *  future zh-TW dictionary on the host Models page). */
const EDIT_LABELS = new Set(['编辑', '編輯', 'Edit'])

/** Whether an aria-label names the row's edit action in any shipped locale. */
const isEditAriaLabel = (label: string): boolean =>
  ['编辑', '編輯', 'Edit'].some(prefix => label.startsWith(prefix))

/**
 * Marks the host's inline provider editor INSIDE a row li. The editor root's
 * CSS-module local name is `editor` (hashed `hash_editor`), so the substring
 * selector matches it in any locale and build. Scoped to the row li, no other
 * host class in a row contains the substring.
 */
const EDITOR_IN_ROW_SELECTOR = '[class*="editor"]'

/** The row's 编辑 button (by label or aria-label, both locales). */
function findEditButton(actions: Element): HTMLButtonElement | undefined {
  return [...actions.querySelectorAll('button')].find(b =>
    EDIT_LABELS.has(b.textContent?.trim() ?? '')
    || isEditAriaLabel(b.getAttribute('aria-label') ?? ''))
}

export interface AugmentDeps {
  /** Active dictionary, re-resolved on every sync so language flips apply. */
  dict: () => Record<string, string>
  /** Fired when the active language flips; re-resolves all managed copy. */
  onLocaleChange: (listener: () => void) => () => void
}

interface Managed {
  el: HTMLElement
  root: Root | null
}

export function setupAugment(deps: AugmentDeps): () => void {
  let disposed = false
  let scheduled = false
  /** Open/close state lives on the container dataset; portals render lazily. */
  const managed = new Set<Managed>()
  let lastStatus: MonitorStatus | null = null

  const chipText = (): string => {
    const d = deps.dict()
    const b = lastStatus?.balance
    return b === null || b === undefined ? `${d.balanceLabel ?? '余额'} --` : `${d.balanceLabel ?? '余额'} ${formatBalance(b)}`
  }

  const renderPanelInto = (managedEntry: Managed): void => {
    if (managedEntry.root !== null) return
    const root = createRoot(managedEntry.el)
    managedEntry.root = root
    root.render(createElement(ProviderPanel, { d: deps.dict() as Record<DeepSeekMonitorKey, string> }))
  }

  /** Re-resolve copy on language flips: chips, buttons, open portals. */
  const refreshTexts = (): void => {
    const d = deps.dict()
    for (const entry of managed) {
      if (entry.el.hasAttribute(CHIP)) entry.el.textContent = chipText()
      if (entry.el.hasAttribute(BTN)) entry.el.textContent = d.usageBtn ?? '用量'
      if (entry.root !== null) entry.root.render(createElement(ProviderPanel, { d: d as Record<DeepSeekMonitorKey, string> }))
    }
  }
  // Keep the unsubscriber: a fiber disposal (HMR) must drop the locale
  // subscription too, or the stale listener keeps re-rendering forever.
  const offLocale = deps.onLocaleChange(refreshTexts)

  const ensureRowPieces = (li: Element): void => {
    const d = deps.dict()
    const head = li.querySelector('[class*="rowHead"]')
    const identity = li.querySelector('[class*="rowIdentity"]')
    const actions = li.querySelector('[class*="rowActions"]')
    if (head === null || identity === null || actions === null) return

    // ① Balance chip next to the identity line.
    let chip = identity.querySelector<HTMLElement>(`[${CHIP}]`)
    if (chip === null) {
      chip = document.createElement('span')
      chip.setAttribute(CHIP, '')
      Object.assign(chip.style, {
        marginLeft: '8px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
      } satisfies Partial<CSSStyleDeclaration>)
      identity.appendChild(chip)
      managed.add({ el: chip, root: null })
    }
    chip.textContent = chipText()

    // ② 「用量」 button LEFT of the row's edit button.
    const editButton = findEditButton(actions)
    let btn = actions.querySelector<HTMLButtonElement>(`[${BTN}]`)
    if (btn === null) {
      btn = document.createElement('button')
      btn.setAttribute(BTN, '')
      btn.type = 'button'
      // Visual parity with the row's own 编辑 button: clone its classes so the
      // HOST stylesheet styles our button (same document, same hashes). The
      // inline fallback only applies when no edit button was found.
      if (editButton !== undefined && editButton.className !== '') {
        btn.className = editButton.className
        btn.style.marginRight = '8px'
      } else {
        Object.assign(btn.style, {
          appearance: 'none',
          border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.35))',
          background: 'transparent',
          color: 'var(--dsw-alias-fg, inherit)',
          borderRadius: '6px',
          padding: '2px 10px',
          fontSize: '12px',
          cursor: 'pointer',
          marginRight: '8px',
        } satisfies Partial<CSSStyleDeclaration>)
      }
      btn.textContent = d.usageBtn ?? '用量'
      if (editButton !== undefined) actions.insertBefore(btn, editButton)
      else actions.prepend(btn)
      managed.add({ el: btn, root: null })
      btn.addEventListener('click', () => {
        const container = li.querySelector<HTMLElement>(`[${PANEL}]`)
        if (container === null) return
        // Mutual exclusion with the host editor: while the editor is open,
        // close IT first (the row's own edit button toggles) — the editor gate
        // below then restores our panel the moment the editor unmounts.
        if (li.querySelector(EDITOR_IN_ROW_SELECTOR) !== null) {
          findEditButton(actions)?.click()
          return
        }
        const open = container.style.display !== 'none'
        container.style.display = open ? 'none' : ''
        if (!open) {
          const entry = [...managed].find(m => m.el === container)
          if (entry !== undefined && entry.root === null) renderPanelInto(entry)
        }
      })
    }

    // ③ Expandable panel container after the row head.
    let container = li.querySelector<HTMLElement>(`[${PANEL}]`)
    if (container === null) {
      container = document.createElement('div')
      container.setAttribute(PANEL, '')
      container.style.display = 'none'
      head.parentElement?.insertBefore(container, head.nextSibling)
      managed.add({ el: container, root: null })
    }
  }

  /**
   * The panel ↔ editor mutual exclusion. The two surfaces share one row and
   * stacking them reads as broken (the expanded panel pushes the editor out
   * of view, and an editor click then looks dead). Policy:
   * - editor opens → collapse our panel, remembering it was visible;
   * - editor closes → restore our panel exactly when we collapsed it.
   * A manual close by the user stays respected: only gate-driven collapses
   * are auto-restored.
   */
  const syncEditorGate = (li: Element): void => {
    const container = li.querySelector<HTMLElement>(`[${PANEL}]`)
    if (container === null) return
    if (li.querySelector(EDITOR_IN_ROW_SELECTOR) !== null) {
      if (container.style.display !== 'none') {
        container.dataset.dsmAutoHidden = '1'
        container.style.display = 'none'
      }
      return
    }
    if (container.dataset.dsmAutoHidden === '1') {
      delete container.dataset.dsmAutoHidden
      container.style.display = ''
      const entry = [...managed].find(m => m.el === container)
      if (entry !== undefined && entry.root === null) renderPanelInto(entry)
    }
  }

  const resync = (): void => {
    if (disposed) return
    try {
      // Drop managed nodes whose host row went away (page switches/removals).
      for (const entry of [...managed]) {
        if (!entry.el.isConnected) {
          entry.root?.unmount()
          managed.delete(entry)
        }
      }
      // Scope the row scan to the open settings dialog: the Models page
      // rows live there, and scanning every li on the whole page (long
      // conversation lists included) on every mutation was pure waste.
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog === null) return
      const candidateRows = [...dialog.querySelectorAll('li')]
      for (const li of candidateRows) {
        const name = li.querySelector('[class*="rowName"]')?.textContent?.trim()
        if (name === undefined || name === '' || !ROW_NAMES.has(name)) continue
        ensureRowPieces(li)
        syncEditorGate(li)
      }
    } catch {
      // A transient host DOM state must never break the observer loop.
    }
  }

  const schedule = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      resync()
    })
  }

  // Status feed for the chip (cached read; never forces upstream here).
  const refreshChipStatus = (): void => {
    void fetchStatus()
      .then((status) => {
        lastStatus = status
        const low = status.lowBalance === true
        for (const entry of managed) {
          if (entry.root === null && entry.el.hasAttribute(CHIP)) {
            entry.el.textContent = chipText()
            entry.el.style.color = low
              ? 'var(--dsw-alias-danger-fg)'
              : 'var(--dsw-alias-label-tertiary)'
          }
        }
      })
      .catch(() => { /* chip keeps its placeholder */ })
  }

  resync()
  refreshChipStatus()
  const statusTimer = window.setInterval(refreshChipStatus, 60_000)
  const safetyTimer = window.setInterval(resync, 3000)
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    disposed = true
    offLocale()
    window.clearInterval(statusTimer)
    window.clearInterval(safetyTimer)
    observer.disconnect()
    for (const entry of managed) {
      entry.root?.unmount()
      entry.el.remove()
    }
    managed.clear()
  }
}
