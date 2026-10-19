import { DomainError } from '../errors.js'
import type { Unit } from '../product/units.js'

export const STOCK_LEVELS = ['none', 'half', 'full'] as const
export type StockLevel = (typeof STOCK_LEVELS)[number]

export const PRODUCT_KINDS = ['food', 'household'] as const
export type ProductKind = (typeof PRODUCT_KINDS)[number]

export function parseStockLevel(value: unknown): StockLevel {
  if (typeof value === 'string' && (STOCK_LEVELS as readonly string[]).includes(value)) {
    return value as StockLevel
  }
  throw new DomainError('INVALID_STOCK_LEVEL', 'Invalid stock level')
}

export function parseProductKind(value: unknown): ProductKind {
  if (typeof value === 'string' && (PRODUCT_KINDS as readonly string[]).includes(value)) {
    return value as ProductKind
  }
  throw new DomainError('INVALID_PRODUCT_KIND', 'Invalid product kind')
}

/** Catalog default: Open Products Facts items are household goods, the rest food. */
export function defaultProductKind(externalCatalog: string | null): ProductKind {
  return externalCatalog === 'open_products_facts' ? 'household' : 'food'
}

export type StockLevelPlan =
  | { action: 'none'; newFullQuantity: number | null }
  | { action: 'consume'; quantity: number; newFullQuantity: number | null }
  | { action: 'add'; quantity: number; newFullQuantity: number | null }

const EPSILON = 1e-6

function roundQuantity(value: number, unit: Unit): number {
  if (unit === 'each') {
    return Math.max(0, Math.round(value))
  }
  return Math.round(value * 1000) / 1000
}

/**
 * Turns "none / half / all" into a stock change.
 *
 * "Full" is the largest quantity Pantry has seen for the product (the stored
 * `fullQuantity`, never less than what is on hand). `none` empties the stock,
 * `half` targets half of full, `full` tops stock up to full. With no reference
 * and nothing on hand, half/full can only be recorded, not applied.
 */
export function planStockLevelChange(input: {
  level: StockLevel
  totalQuantity: number
  fullQuantity: number | null
  unit: Unit
}): StockLevelPlan {
  const total = Math.max(0, input.totalQuantity)
  const knownFull = input.fullQuantity != null && input.fullQuantity > 0 ? input.fullQuantity : null
  const full = Math.max(knownFull ?? 0, total) || null

  if (input.level === 'none') {
    return total > EPSILON
      ? { action: 'consume', quantity: total, newFullQuantity: full }
      : { action: 'none', newFullQuantity: full }
  }

  if (full == null) {
    return { action: 'none', newFullQuantity: null }
  }

  let target = input.level === 'full' ? full : full / 2
  target = roundQuantity(target, input.unit)
  if (input.level === 'half' && input.unit === 'each') {
    target = Math.max(1, target)
  }

  const delta = roundQuantity(target - total, input.unit)
  if (Math.abs(delta) < EPSILON) {
    return { action: 'none', newFullQuantity: full }
  }
  return delta < 0
    ? { action: 'consume', quantity: -delta, newFullQuantity: full }
    : { action: 'add', quantity: delta, newFullQuantity: full }
}

/** Stock check is due `intervalDays` after the last answer (or first stocking). */
export function isStockCheckDue(input: {
  lastCheckedAt: string | null
  firstStockedAt: string | null
  intervalDays: number
  now: Date
}): boolean {
  const anchor = input.lastCheckedAt ?? input.firstStockedAt
  if (!anchor) {
    return false
  }
  const anchorMs = Date.parse(anchor)
  if (Number.isNaN(anchorMs)) {
    return false
  }
  return input.now.getTime() - anchorMs >= input.intervalDays * 86_400_000
}
