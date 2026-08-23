import { describe, expect, it } from 'vitest'
import { amountTone, isOfficialDeepSeek, parseAmount } from '../src/client/BalanceChip.tsx'

describe('isOfficialDeepSeek', () => {
  it('accepts the official provider ids', () => {
    expect(isOfficialDeepSeek({ provider: 'deepseek', model: 'whatever' })).toBe(true)
    expect(isOfficialDeepSeek({ provider: 'deepseek-official', model: '' })).toBe(true)
    expect(isOfficialDeepSeek({ provider: 'llm-deepseek', model: '' })).toBe(true)
  })

  it('accepts any deepseek-prefixed model regardless of provider id', () => {
    expect(isOfficialDeepSeek({ provider: '', model: 'DeepSeek-V3.2' })).toBe(true)
    expect(isOfficialDeepSeek({ provider: 'custom', model: 'deepseek-chat' })).toBe(true)
  })

  it('rejects other providers and absent routes', () => {
    expect(isOfficialDeepSeek({ provider: 'openai', model: 'gpt-5' })).toBe(false)
    expect(isOfficialDeepSeek({ provider: 'anthropic', model: 'claude-4-sonnet' })).toBe(false)
    expect(isOfficialDeepSeek(null)).toBe(false)
    expect(isOfficialDeepSeek(undefined)).toBe(false)
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
