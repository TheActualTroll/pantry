import type { ReceiptExtractResponse } from './pantry-api'

type Receipt = ReceiptExtractResponse['receipt']

/**
 * Combines the readings of several photos of one (long) receipt. Header fields
 * come from the first photo that has them; the total from the last, because it
 * is printed at the bottom.
 */
export function mergeReceipts(parts: Receipt[]): Receipt {
  const firstWith = <K extends 'merchant' | 'date' | 'currency'>(key: K) =>
    parts.find((part) => part[key] != null)?.[key] ?? null
  const total = [...parts].reverse().find((part) => part.total != null)?.total ?? null
  return {
    merchant: firstWith('merchant'),
    date: firstWith('date'),
    currency: firstWith('currency'),
    total,
    items: parts.flatMap((part) => part.items),
  }
}
