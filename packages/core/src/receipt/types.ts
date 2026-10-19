import type { Unit } from '../product/units.js'

export const RECEIPT_MAX_IMAGE_BYTES = 2_500_000
export const RECEIPT_MAX_ITEMS = 80

export const RECEIPT_WEIGHT_UNITS = ['g', 'kg', 'ml', 'l'] as const
export type ReceiptWeightUnit = (typeof RECEIPT_WEIGHT_UNITS)[number]

export const RECEIPT_CATEGORIES = ['food', 'household'] as const
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number]

/** Longest shelf life the model may suggest. Anything longer is treated as unknown. */
export const RECEIPT_MAX_SHELF_LIFE_DAYS = 1095

export type ReceiptDraftItem = {
  rawName: string
  name: string
  quantity: number | null
  unit: Unit | null
  lineTotal: number | null
  weightValue: number | null
  weightUnit: ReceiptWeightUnit | null
  confidence: number | null
  /** food vs household goods (cleaning, paper, hygiene). */
  category: ReceiptCategory
  /** Typical days until it spoils once bought; null for non-perishables. */
  shelfLifeDays: number | null
}

export type ReceiptDraft = {
  merchant: string | null
  date: string | null
  currency: string | null
  total: number | null
  items: ReceiptDraftItem[]
}

export type ReceiptProductMatch = {
  id: string
  name: string
  brand: string | null
  unit: Unit
  packageQuantity: number | null
  packageUnit: Unit | null
}

export type ReceiptDraftLine = ReceiptDraftItem & {
  suggestedProduct: ReceiptProductMatch | null
  suggestedQuantity: number | null
  suggestedUnit: Unit | null
}
