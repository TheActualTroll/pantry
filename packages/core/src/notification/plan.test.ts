import { describe, expect, test } from 'vitest'
import { localDateAndHour, planNotifications, type StockCheckCandidate } from './plan.js'

const base = {
  today: '2026-10-20',
  locale: 'en' as const,
  preferences: { expiryEnabled: true, lowStockEnabled: true, stockChecksEnabled: true, expiryLeadDays: 3 },
  expiring: [],
  lowStock: [],
  stockChecks: [],
  alreadySent: new Set<string>(),
}

describe('planNotifications', () => {
  test('groups expiring lots into one digest, soonest first', () => {
    const [digest] = planNotifications({
      ...base,
      expiring: [
        { lotId: 'b', productName: 'Yogurt', expiresOn: '2026-10-22' },
        { lotId: 'a', productName: 'Milk', expiresOn: '2026-10-21' },
        { lotId: 'c', productName: 'Rice', expiresOn: '2026-12-01' },
      ],
    })
    expect(digest?.kind).toBe('expiry')
    expect(digest?.payload.title).toBe('2 items are expiring soon')
    expect(digest?.payload.body).toBe('Milk (tomorrow), Yogurt (in 2 days)')
    expect(digest?.refKeys).toEqual(['a:2026-10-21:soon', 'b:2026-10-22:soon'])
  })

  test('never repeats something already announced', () => {
    const planned = planNotifications({
      ...base,
      expiring: [{ lotId: 'a', productName: 'Milk', expiresOn: '2026-10-21' }],
      alreadySent: new Set(['expiry|a:2026-10-21:soon']),
    })
    expect(planned).toEqual([])
  })

  test('announces expiry again when the stage advances', () => {
    const planned = planNotifications({
      ...base,
      today: '2026-10-21',
      expiring: [{ lotId: 'a', productName: 'Milk', expiresOn: '2026-10-21' }],
      alreadySent: new Set(['expiry|a:2026-10-21:soon']),
    })
    expect(planned[0]?.payload.body).toBe('Milk (today)')
  })

  test('respects disabled preferences', () => {
    const planned = planNotifications({
      ...base,
      preferences: { ...base.preferences, expiryEnabled: false, lowStockEnabled: false, stockChecksEnabled: false },
      expiring: [{ lotId: 'a', productName: 'Milk', expiresOn: '2026-10-21' }],
      lowStock: [{ productId: 'p', productName: 'Soap' }],
      stockChecks: [{ householdId: 'h', productId: 'p', productName: 'Soap' }],
    })
    expect(planned).toEqual([])
  })

  test('stock checks carry none/all buttons and are capped per run', () => {
    const stockChecks: StockCheckCandidate[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      householdId: 'h',
      productId: id,
      productName: `Item ${id}`,
    }))
    const planned = planNotifications({ ...base, stockChecks })
    expect(planned).toHaveLength(3)
    expect(planned[0]?.payload.actions?.map((action) => action.action)).toEqual(['none', 'full'])
    expect(planned[0]?.payload.actions?.map((action) => action.title)).toEqual(['None', 'All'])
    expect(planned[0]?.payload.data).toEqual({
      kind: 'stock_check',
      lang: 'en',
      householdId: 'h',
      productId: 'a',
      productName: 'Item a',
    })
  })

  test('localizes to Romanian', () => {
    const [check] = planNotifications({
      ...base,
      locale: 'ro',
      stockChecks: [{ householdId: 'h', productId: 'p', productName: 'Detergent' }],
    })
    expect(check?.payload.title).toBe('Cât mai ai din Detergent?')
    expect(check?.payload.actions?.map((action) => action.title)).toEqual(['Nimic', 'Tot'])
  })
})

describe('localDateAndHour', () => {
  test('uses the target timezone', () => {
    const now = new Date('2026-10-20T22:30:00Z')
    expect(localDateAndHour(now, 'Europe/Bucharest')).toEqual({ date: '2026-10-21', hour: 1 })
    expect(localDateAndHour(now, 'UTC')).toEqual({ date: '2026-10-20', hour: 22 })
    expect(localDateAndHour(now, 'Not/AZone')).toEqual({ date: '2026-10-20', hour: 22 })
  })
})
