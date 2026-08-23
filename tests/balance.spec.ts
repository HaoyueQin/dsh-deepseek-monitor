import { describe, expect, it } from 'vitest'
import { pickCnyBalanceInfo } from '../src/balance.ts'

describe('pickCnyBalanceInfo', () => {
  it('prefers CNY even when USD comes first (case-insensitive)', () => {
    const infos = [
      { currency: 'USD', total_balance: '0.00' },
      { currency: 'cny', total_balance: '80.47' },
    ]
    expect(pickCnyBalanceInfo(infos)).toBe(infos[1])
  })

  it('falls back to the first entry when no CNY row exists', () => {
    const infos = [{ currency: 'USD', total_balance: '5.00' }]
    expect(pickCnyBalanceInfo(infos)).toBe(infos[0])
  })

  it('returns undefined for an empty list', () => {
    expect(pickCnyBalanceInfo([])).toBeUndefined()
  })
})
