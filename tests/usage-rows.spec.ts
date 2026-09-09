/**
 * Locks the provider-panel row fold: legacy filtering, display order, the
 * unknown-model graceful bucket, input immutability, and the scale floor.
 */
import { describe, expect, it } from 'vitest'
import { MAX_MONTH_OFFSET, maxRowTokens, selectRowModels } from '../src/client/usage-rows.ts'
import type { UsageModelSummary } from '../src/wire.ts'

const row = (key: string, name: string, totalTokens: number): UsageModelSummary => ({
  key,
  name,
  totalTokens,
  requestCount: 1,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  responseTokens: 0,
  cost: 0,
})

describe('selectRowModels', () => {
  it('filters the retired legacy pair by name or key', () => {
    const models = [
      row('deepseek-chat', 'deepseek-chat', 10),
      row('deepseek-reasoner', 'deepseek-reasoner', 10),
      row('x', 'deepseek-chat & deepseek-reasoner', 10),
      row('flash', 'deepseek-v4-flash', 5),
    ]
    expect(selectRowModels(models).map(m => m.key)).toEqual(['flash'])
  })

  it('orders Flash, Flash Vision, Pro, then unknown keys by name', () => {
    const models = [
      row('pro', 'deepseek-v4-pro', 1),
      row('zeta', 'zeta-model', 1),
      row('flash-vision', 'deepseek-v4-flash-vision-exp', 1),
      row('alpha', 'alpha-model', 1),
      row('flash', 'deepseek-v4-flash', 1),
    ]
    expect(selectRowModels(models).map(m => m.key)).toEqual([
      'flash',
      'flash-vision',
      'pro',
      'alpha',
      'zeta',
    ])
  })

  it('keeps zero-usage rows and never mutates the input', () => {
    const models = [row('pro', 'deepseek-v4-pro', 0), row('flash', 'deepseek-v4-flash', 7)]
    const snapshot = models.map(m => m.key)
    const selected = selectRowModels(models)
    expect(selected.map(m => m.key)).toEqual(['flash', 'pro'])
    expect(models.map(m => m.key)).toEqual(snapshot)
  })
})

describe('maxRowTokens', () => {
  it('floors an empty month at 1 and picks the max otherwise', () => {
    expect(maxRowTokens([])).toBe(1)
    expect(maxRowTokens([row('flash', 'f', 3), row('pro', 'p', 9)])).toBe(9)
  })
})

describe('MAX_MONTH_OFFSET', () => {
  it('caps the back-step at 5 years', () => {
    expect(MAX_MONTH_OFFSET).toBe(60)
  })
})
