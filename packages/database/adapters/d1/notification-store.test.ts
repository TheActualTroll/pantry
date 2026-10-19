import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { DomainError } from '@pantry/core'
import { applyPantryMigrations, insertProfile, insertUser, sqliteAsD1 } from './sqlite-as-d1.js'
import { createD1HouseholdStore } from './household-store.js'
import { createD1InventoryStore } from './inventory-store.js'
import { createD1NotificationStore } from './notification-store.js'
import { createD1ProductStore } from './product-store.js'

async function setup() {
  const sqlite = new DatabaseSync(':memory:')
  applyPantryMigrations(sqlite)
  const db = sqliteAsD1(sqlite)
  insertUser(sqlite, 'user-1', 'User', 'user-1@example.invalid')
  insertProfile(sqlite, 'user-1', 'User')
  const households = createD1HouseholdStore(db)
  const created = await households.createHouseholdWithOwnerAndLocations({
    userId: 'user-1',
    name: 'Casa',
    ownerDisplayName: 'User',
  })
  const location = created.locations[0]
  if (!location) {
    throw new Error('missing location')
  }
  return {
    sqlite,
    householdId: created.household.id,
    locationId: location.id,
    store: createD1NotificationStore(db),
    products: createD1ProductStore(db),
    inventory: createD1InventoryStore(db),
  }
}

test('preferences default, validate, and persist', async () => {
  const { store } = await setup()
  expect((await store.getPreferences('user-1')).notifyHour).toBe(9)

  const saved = await store.setPreferences('user-1', { expiryLeadDays: 5, timezone: 'Europe/Bucharest' })
  expect(saved.expiryLeadDays).toBe(5)
  expect((await store.getPreferences('user-1')).timezone).toBe('Europe/Bucharest')

  await expect(store.setPreferences('user-1', { notifyHour: 30 })).rejects.toBeInstanceOf(DomainError)
  await expect(store.setPreferences('user-1', { timezone: 'Mars/Base' })).rejects.toBeInstanceOf(DomainError)
})

test('subscriptions are unique per endpoint and can be removed', async () => {
  const { store } = await setup()
  await store.upsertSubscription('user-1', { endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' })
  await store.upsertSubscription('user-1', { endpoint: 'https://push.example/abc', p256dh: 'k2', auth: 'a2' })
  const subs = await store.listSubscriptions('user-1')
  expect(subs).toHaveLength(1)
  expect(subs[0]?.p256dh).toBe('k2')
  expect(await store.listSubscribedUsers()).toEqual([{ userId: 'user-1', locale: 'ro' }])

  await expect(
    store.upsertSubscription('user-1', { endpoint: 'http://insecure.example', p256dh: 'k', auth: 'a' }),
  ).rejects.toBeInstanceOf(DomainError)

  await store.removeSubscriptionByEndpoint('https://push.example/abc')
  expect(await store.listSubscriptions('user-1')).toEqual([])
})

test('sent keys dedupe and run markers persist', async () => {
  const { store } = await setup()
  await store.recordSent('user-1', 'expiry', ['lot:1', 'lot:2'])
  await store.recordSent('user-1', 'expiry', ['lot:1'])
  expect([...(await store.sentKeys('user-1', 'expiry'))].sort()).toEqual(['lot:1', 'lot:2'])
  expect((await store.sentKeys('user-1', 'low_stock')).size).toBe(0)

  expect(await store.getLastRun('user-1')).toBeNull()
  await store.markRun('user-1', '2026-10-20')
  expect(await store.getLastRun('user-1')).toBe('2026-10-20')
})

test('product kind defaults from the catalog and can be overridden', async () => {
  const { store, products, householdId } = await setup()
  const soap = await products.createManualProduct({ householdId, name: 'Soap', unit: 'each' })
  expect(await store.getProductKind({ householdId, productId: soap.id })).toBe('food')
  await store.setProductKind({ householdId, productId: soap.id, kind: 'household' })
  expect(await store.getProductKind({ householdId, productId: soap.id })).toBe('household')
})

test('only household items come due for a stock check, once the interval passes', async () => {
  const { store, products, inventory, householdId, locationId } = await setup()
  const soap = await products.createManualProduct({ householdId, name: 'Soap', unit: 'each' })
  const milk = await products.createManualProduct({ householdId, name: 'Milk', unit: 'each' })
  await store.setProductKind({ householdId, productId: soap.id, kind: 'household' })
  for (const product of [soap, milk]) {
    await inventory.addStock({ householdId, userId: 'user-1', productId: product.id, locationId, quantity: 2 })
  }

  const soon = new Date(Date.now() + 86_400_000)
  expect(await store.listStockChecksDue({ householdId, now: soon })).toEqual([])

  const later = new Date(Date.now() + 15 * 86_400_000)
  const due = await store.listStockChecksDue({ householdId, now: later })
  expect(due.map((item) => item.productName)).toEqual(['Soap'])

  await store.recordStockLevel({ householdId, productId: soap.id, level: 'half', fullQuantity: 2, now: later })
  expect(await store.listStockChecksDue({ householdId, now: later })).toEqual([])
  expect(await store.getFullQuantity({ householdId, productId: soap.id })).toBe(2)
})

test('full quantity only ever grows', async () => {
  const { store, products, householdId } = await setup()
  const soap = await products.createManualProduct({ householdId, name: 'Soap', unit: 'each' })
  await store.bumpFullQuantity({ householdId, productId: soap.id, quantity: 4 })
  await store.bumpFullQuantity({ householdId, productId: soap.id, quantity: 2 })
  expect(await store.getFullQuantity({ householdId, productId: soap.id })).toBe(4)
})

test('low stock lists products at or below their minimum', async () => {
  const { store, products, inventory, householdId, locationId } = await setup()
  const soap = await products.createManualProduct({ householdId, name: 'Soap', unit: 'each' })
  await inventory.addStock({ householdId, userId: 'user-1', productId: soap.id, locationId, quantity: 1 })
  await inventory.setMinimumQuantity({ householdId, productId: soap.id, minimumQuantity: 2 })
  expect(await store.listLowStockProducts({ householdId })).toEqual([{ productId: soap.id, productName: 'Soap' }])
})
