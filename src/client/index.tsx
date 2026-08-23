/**
 * dsh-deepseek-monitor browser half: registers the conversation composer.dock
 * balance item (official slot) and the DeepSeek provider-row augmentation
 * engine (chip + 用量 button + expandable panel inside 设置→模型→DeepSeek).
 * No standalone settings section by design — monitoring lives in the row.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation SlotMap merge ('conversation.composer.dock').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BalanceDock } from './BalanceDock.tsx'
import { setupAugment } from './augment.tsx'
import { LOCALE_NS, en, zh, zhTW, type DeepSeekMonitorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
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

  // The conversation stats-band balance item (official composer.dock seat).
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'deepseek-balance',
    order: 10,
    locale: LOCALE_NS,
  }, BalanceDock))

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
