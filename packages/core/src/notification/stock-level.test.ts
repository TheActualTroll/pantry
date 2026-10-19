import { describe, expect, test } from 'vitest'
import { DomainError } from '../errors.js'
import {
  defaultProductKind,
  isStockCheckDue,
  parseProductKind,
  parseStockLevel,
  planStockLevelChange,
} from './stock-level.js'

describe('parsers', () => {
  test('accepts only known levels and kinds', () => {
    expect(parseStockLevel('half')).toBe('half')
    expect(() => parseStockLevel('most')).toThrow(DomainError)
    expect(parseProductKind('household')).toBe('household')
    expect(() => parseProductKind('drink')).toThrow(DomainError)
  })

  test('derives the default kind from the catalog', () => {
    expect(defaultProductKind('open_products_facts')).toBe('household')
    expect(defaultProductKind('open_food_facts')).toBe('food')
    expect(defaultProductKind(null)).toBe('food')
  })
})

describe('planStockLevelChange', () => {
  test('none consumes everything on hand', () => {
    expect(planStockLevelChange({ level: 'none', totalQuantity: 3, fullQuantity: 4, unit: 'each' })).toEqual({
      action: 'consume',
      quantity: 3,
      newFullQuantity: 4,
    })
  })

  test('none with nothing on hand records only', () => {
    expect(planStockLevelChange({ level: 'none', totalQuantity: 0, fullQuantity: null, unit: 'g' }).action).toBe('none')
  })

  test('half consumes down to half of full', () => {
    expect(planStockLevelChange({ level: 'half', totalQuantity: 1000, fullQuantity: 1000, unit: 'ml' })).toEqual({
      action: 'consume',
      quantity: 500,
      newFullQuantity: 1000,
    })
  })

  test('half tops up when stock is below half', () => {
    expect(planStockLevelChange({ level: 'half', totalQuantity: 100, fullQuantity: 1000, unit: 'ml' })).toEqual({
      action: 'add',
      quantity: 400,
      newFullQuantity: 1000,
    })
  })

  test('full tops stock up to the full quantity', () => {
    expect(planStockLevelChange({ level: 'full', totalQuantity: 250, fullQuantity: 1000, unit: 'g' })).toEqual({
      action: 'add',
      quantity: 750,
      newFullQuantity: 1000,
    })
  })

  test('full is a no-op when already full, and full never shrinks below on-hand stock', () => {
    expect(planStockLevelChange({ level: 'full', totalQuantity: 6, fullQuantity: 4, unit: 'each' })).toEqual({
      action: 'none',
      newFullQuantity: 6,
    })
  })

  test('half of a single countable item keeps it', () => {
    expect(planStockLevelChange({ level: 'half', totalQuantity: 1, fullQuantity: 1, unit: 'each' }).action).toBe('none')
  })

  test('half/full without any reference cannot be applied', () => {
    expect(planStockLevelChange({ level: 'full', totalQuantity: 0, fullQuantity: null, unit: 'each' })).toEqual({
      action: 'none',
      newFullQuantity: null,
    })
  })
})

describe('isStockCheckDue', () => {
  const now = new Date('2026-10-20T08:00:00Z')

  test('is due once the interval has passed since the last check', () => {
    expect(isStockCheckDue({ lastCheckedAt: '2026-10-05T08:00:00Z', firstStockedAt: null, intervalDays: 14, now })).toBe(true)
    expect(isStockCheckDue({ lastCheckedAt: '2026-10-10T08:00:00Z', firstStockedAt: null, intervalDays: 14, now })).toBe(false)
  })

  test('falls back to when the product was first stocked', () => {
    expect(isStockCheckDue({ lastCheckedAt: null, firstStockedAt: '2026-09-01T00:00:00Z', intervalDays: 14, now })).toBe(true)
    expect(isStockCheckDue({ lastCheckedAt: null, firstStockedAt: null, intervalDays: 14, now })).toBe(false)
  })
})
