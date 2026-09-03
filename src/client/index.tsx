/**
 * dsh-deepseek-monitor browser half: registers the conversation input-row
 * balance chip (official `conversation.input.right` seat — rendered left of
 * the model name) and the DeepSeek provider-row augmentation engine (chip +
 * 用量 button + expandable panel inside 设置→模型→DeepSeek).
 * No standalone settings section by design — monitoring lives in the row.
 */
// DSH 0.1.2-rc.1 baseline: ClientContext is the cordis Context; the `slots`
// service lives on dsh-client-ui-renderer's SlotRegistry; the sessionId merge
// lives on ui-session's SessionStandardProps. The faces below are mirrored
// (never imported for values) exactly as rc.1 declares them, so a type drift
// from upstream is caught here at build time against the rc.1 dev baseline.
import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BalanceChip } from './BalanceChip.tsx'
import { setupAugment } from './augment.tsx'
import { LOCALE_NS, en, zh, zhTW, type DeepSeekMonitorKey } from './locales.ts'

/** Client-half context alias (the type is the cordis Context on this kernel). */
type ClientContext = Context

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Slot registry service (ui-renderer's SlotRegistry on 0.1.2-rc.1). */
    slots: SlotRegistry
    /** Browser locale registry (locale's LocaleRuntime face, rc.1). */
    locale: {
      register(ns: string, locale: string, dict: Record<string, string>): () => void
      getLocale(): { active: string }
      subscribe(listener: () => void): () => void
    }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** ui-conversation's declaration on 0.1.2-rc.1 (kind list / scope
     *  session; no owner share). */
    'conversation.input.right': {
      kind: 'list'
      scope: 'session'
    }
  }
  interface SessionStandardProps {
    /** Framework-resolved current session id (ui-session merge on rc.1). */
    sessionId: string
  }
  interface LocaleNamespaceMap {
    'deepseekMonitor': DeepSeekMonitorKey
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  // Register the dictionaries; disposers run on fiber disposal so
  // re-activation (HMR) re-registers.
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    const offZhTw = ctx.locale.register(LOCALE_NS, 'zh-TW', zhTW)
    return () => { offZh(); offEn(); offZhTw() }
  }, 'dsh-deepseek-monitor: dictionaries')

  // The composer tool-row balance chip (official input.right seat). The
  // host's trailing group renders these entries left of the model name, so
  // the chip sits exactly between the left chrome and the model select with
  // the row's standard 12px gap — a real flex child, no host-DOM surgery.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'deepseek-balance',
    order: 10,
    locale: LOCALE_NS,
  }, BalanceChip))

  // The provider-row augmentation. The locale face (getLocale().active /
  // subscribe) is exactly what the rc.1 LocaleRuntime exposes.
  ctx.effect(() => {
    const dict = (): Record<string, string> => {
      const active = ctx.locale.getLocale().active
      return active === 'en' ? en : active === 'zh-TW' ? zhTW : zh
    }
    return setupAugment({
      dict,
      onLocaleChange: listener => ctx.locale.subscribe(listener),
    })
  }, 'dsh-deepseek-monitor: provider-row augmentation')
}
