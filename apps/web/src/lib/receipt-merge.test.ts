import { expect, test } from 'vitest'
import { mergeReceipts } from './receipt-merge'

const item = (name: string) => ({
  rawName: name,
  name,
  quantity: 1,
  unit: null,
  lineTotal: null,
  weightValue: null,
  weightUnit: null,
  confidence: 0.9,
  suggestedProduct: null,
  suggestedQuantity: 1,
  suggestedUnit: null,
  category: 'food' as const,
  shelfLifeDays: null,
})

test('merges photos of one receipt', () => {
  const merged = mergeReceipts([
    { merchant: 'Lidl', date: '2026-10-19', currency: 'RON', total: null, items: [item('Lapte')] },
    { merchant: null, date: null, currency: null, total: 42.5, items: [item('Pâine'), item('Ouă')] },
  ])
  expect(merged).toMatchObject({ merchant: 'Lidl', date: '2026-10-19', currency: 'RON', total: 42.5 })
  expect(merged.items.map((entry) => entry.name)).toEqual(['Lapte', 'Pâine', 'Ouă'])
})
