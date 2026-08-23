/**
 * Balance display helpers shared by the provider-row chip and the composer
 * band. The official API returns the amount as a verbatim string plus a
 * currency code; rendering joins a SYMBOL so a USD account no longer shows a
 * CNY-only "¥" prefix (the panel used to hardcode one).
 */
import type { BalanceSnapshot } from '../wire.ts'

/** Common currency symbols; anything else falls back to the ISO code. */
const SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  TWD: 'NT$',
  SGD: 'S$',
}

/** Display symbol for an ISO currency code ("USD" when unknown). */
export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? `${code} `
}

/** "¥12.34" / "$5.00" / "XYZ 7.00" from a snapshot. */
export function formatBalance(b: Pick<BalanceSnapshot, 'currency' | 'totalBalance'>): string {
  return `${currencySymbol(b.currency)}${b.totalBalance}`
}
