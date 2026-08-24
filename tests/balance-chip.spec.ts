import { describe, expect, it } from 'vitest'
import { amountTone, isOfficialDeepSeek, OFFICIAL_DEEPSEEK_PROVIDER, parseAmount, shouldRenderChip } from '../src/client/BalanceChip.tsx'

describe('isOfficialDeepSeek', () => {
  it('accepts ONLY the built-in official provider, whatever the model name', () => {
    expect(OFFICIAL_DEEPSEEK_PROVIDER).toBe('deepseek-official')
    expect(isOfficialDeepSeek({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBe(true)
    expect(isOfficialDeepSeek({ provider: 'deepseek-official', model: '' })).toBe(true)
  })

  it('rejects a deepseek-named model served by a third-party provider', () => {
    // The bug: a provider-agnostic model-name check lit up the official
    // balance chip for third-party routes serving deepseek-* models.
    expect(isOfficialDeepSeek({ provider: 'custom', model: 'deepseek-chat' })).toBe(false)
    expect(isOfficialDeepSeek({ provider: '', model: 'DeepSeek-V3.2' })).toBe(false)
  })

  it('rejects lookalike and unrelated provider ids', () => {
    expect(isOfficialDeepSeek({ provider: 'deepseek', model: 'whatever' })).toBe(false)
    expect(isOfficialDeepSeek({ provider: 'llm-deepseek', model: 'deepseek-v4-flash' })).toBe(false)
    expect(isOfficialDeepSeek({ provider: 'openai', model: 'gpt-5' })).toBe(false)
    expect(isOfficialDeepSeek({ provider: 'anthropic', model: 'claude-4-sonnet' })).toBe(false)
  })

  it('rejects absent routes', () => {
    expect(isOfficialDeepSeek(null)).toBe(false)
    expect(isOfficialDeepSeek(undefined)).toBe(false)
  })
})

describe('shouldRenderChip', () => {
  it('renders only when every gate holds', () => {
    expect(shouldRenderChip({ alive: true, composerChipEnabled: true, route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })).toBe(true)
  })

  it('treats an absent flag (pre-upgrade build) as enabled', () => {
    expect(shouldRenderChip({ alive: true, composerChipEnabled: undefined, route: { provider: 'deepseek-official', model: 'x' } })).toBe(true)
  })

  it('hides when the 账户明细 switch is off', () => {
    expect(shouldRenderChip({ alive: true, composerChipEnabled: false, route: { provider: 'deepseek-official', model: 'x' } })).toBe(false)
  })

  it('hides when the service is down, the route is not official, or there is no route', () => {
    expect(shouldRenderChip({ alive: null, composerChipEnabled: true, route: { provider: 'deepseek-official', model: 'x' } })).toBe(false)
    expect(shouldRenderChip({ alive: true, composerChipEnabled: true, route: { provider: 'openai', model: 'gpt-5' } })).toBe(false)
    expect(shouldRenderChip({ alive: true, composerChipEnabled: true, route: null })).toBe(false)
  })
})

describe('parseAmount', () => {
  it('parses the verbatim upstream strings', () => {
    expect(parseAmount('80.47')).toBe(80.47)
    expect(parseAmount('0.00')).toBe(0)
    expect(parseAmount('-3.20')).toBe(-3.2)
  })

  it('returns null for non-finite garbage instead of throwing', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('n/a')).toBeNull()
  })
})

describe('amountTone', () => {
  it('is positive strictly above zero', () => {
    expect(amountTone(0.01)).toBe('positive')
    expect(amountTone(80.47)).toBe('positive')
  })

  it('turns red at exactly zero and below (policy: ≤ 0)', () => {
    expect(amountTone(0)).toBe('nonpositive')
    expect(amountTone(-1)).toBe('nonpositive')
  })

  it('stays neutral without a readable snapshot', () => {
    expect(amountTone(null)).toBe('neutral')
  })
})
