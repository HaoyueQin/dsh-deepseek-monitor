/**
 * dsh-deepseek-monitor browser half: registers the conversation input-row
 * balance chip (official `conversation.input.right` seat — rendered left of
 * the model name) and the DeepSeek provider-row augmentation engine (chip +
 * 用量 button + expandable panel inside 设置→模型→DeepSeek).
 * No standalone settings section by design — monitoring lives in the row.
 */
// Cross-version client context (structural mirror, same discipline as the host
// half's context-types.ts): `@deepseek-ai/dsh-client-runtime` — the 0.1.1-rc.2 home
// of ClientContext, the `slots` service and the SessionStandardProps sessionId
// merge — is retired in dsh 0.1.2-alpha.1 (ClientContext is now just the cordis
// Context; `slots` moved to dsh-client-ui-renderer; the sessionId merge moved into
// ui-conversation/ui-chat/ui-session). No upstream type-graph address spans both
// kernels, so the small faces this plugin touches are mirrored here; register/
// inject signatures were cross-checked against 0.1.1-rc.2 and 0.1.2-alpha.1 sources
// and are identical.
import type { Context } from '@deepseek-ai/cordis'
import { BalanceChip } from './BalanceChip.tsx'
import { setupAugment } from './augment.tsx'
import { LOCALE_NS, en, zh, zhTW, type DeepSeekMonitorKey } from './locales.ts'

/** Client-half context alias (the type is the cordis Context on both kernels). */
type ClientContext = Context

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Slot registry service (runtime on 0.1.1-rc.2, ui-renderer on 0.1.2-alpha.1). */
    slots: {
      inject(key: string, callback: () => (() => void) | void): () => void
      register(options: {
        name: string
        id?: string
        order?: number
        locale?: string
      }, component: unknown): () => void
    }
    /** Browser locale registry (same face on both kernels). */
    locale: {
      register(ns: string, locale: string, dict: Record<string, string>): () => void
    }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Structural mirror of ui-conversation's declaration — identical on
     *  0.1.1-rc.2 and 0.1.2-alpha.1 (kind list / scope session / owner InputZone). */
    'conversation.input.right': {
      kind: 'list'
      scope: 'session'
      owner: object
    }
  }
  interface SessionStandardProps {
    /** Framework-resolved current session id (mirror of the runtime/upstream merge). */
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

  // The provider-row augmentation. The locale service face is read through a
  // narrow structural cast (getLocale().active / subscribe), matching what the
  // runtime exposes on this build.
  ctx.effect(() => {
    const locale = ctx.locale as unknown as {
      getLocale?: () => { active?: string }
      subscribe?: (listener: () => void) => () => void
    }
    const dict = (): Record<string, string> => {
      const active = locale.getLocale?.().active
      return active === 'en' ? en : active === 'zh-TW' ? zhTW : zh
    }
    return setupAugment({
      dict,
      onLocaleChange: listener => locale.subscribe?.(listener) ?? (() => {}),
    })
  }, 'dsh-deepseek-monitor: provider-row augmentation')
}
