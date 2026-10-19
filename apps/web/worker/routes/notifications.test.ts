import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../auth/session.js', () => ({
  resolveCurrentUser: vi.fn(),
}))

import { createD1InventoryStore, createD1NotificationStore, createD1ProductStore } from '@pantry/database/d1'
import { resolveCurrentUser } from '../auth/session.js'
import { app } from '../index'
import { runNotificationCycle } from '../notifications/run'
import { envWithDb, insertProfile, insertUser, openPantryDb, sqliteAsD1 } from '../test/sqlite-d1'

const resolveCurrentUserMock = vi.mocked(resolveCurrentUser)

beforeEach(() => {
  resolveCurrentUserMock.mockReset()
  resolveCurrentUserMock.mockResolvedValue(null)
})

async function setup() {
  const db = openPantryDb()
  insertUser(db, 'user-1', 'User', 'user-1@example.invalid')
  insertProfile(db, 'user-1', 'User')
  resolveCurrentUserMock.mockResolvedValue({ id: 'user-1', name: 'User' })
  const sent: Array<{ endpoint: string; payload: Record<string, unknown> }> = []
  const env = {
    ...envWithDb(db),
    VAPID_PUBLIC_KEY: 'public-key',
    PUSH_SENDER: async (subscription: { endpoint: string }, payload: string) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) as Record<string, unknown> })
      return { ok: true as const }
    },
  }

  const call = (path: string, init?: RequestInit) =>
    app.request(
      `/api/v1${path}`,
      { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } },
      env,
    )

  const created = await call('/households', { method: 'POST', body: JSON.stringify({ name: 'Casa' }) })
  const { household } = (await created.json()) as { household: { id: string } }
  const locations = (await (await call('/locations')).json()) as { locations: Array<{ id: string }> }
  const locationId = locations.locations[0]?.id ?? ''

  const d1 = sqliteAsD1(db)
  const products = createD1ProductStore(d1)
  const inventory = createD1InventoryStore(d1)
  const notificationStore = createD1NotificationStore(d1)
  return { db, env, call, sent, householdId: household.id, locationId, products, inventory, notificationStore }
}

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  timezone: 'Europe/Bucharest',
}

test('requires auth', async () => {
  const { call } = await setup()
  resolveCurrentUserMock.mockResolvedValue(null)
  expect((await call('/notifications')).status).toBe(401)
  expect((await call('/stock-checks')).status).toBe(401)
})

test('subscribe validates the endpoint and stores the timezone', async () => {
  const { call, notificationStore } = await setup()

  const bad = await call('/notifications/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ ...SUBSCRIPTION, endpoint: 'https://internal.example/x' }),
  })
  expect(bad.status).toBe(400)

  const ok = await call('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(SUBSCRIPTION) })
  expect(ok.status).toBe(200)
  expect(await notificationStore.listSubscriptions('user-1')).toHaveLength(1)

  const config = (await (await call('/notifications')).json()) as {
    supported: boolean
    vapidPublicKey: string
    preferences: { timezone: string }
    subscriptionCount: number
  }
  expect(config).toMatchObject({
    supported: true,
    vapidPublicKey: 'public-key',
    subscriptionCount: 1,
    preferences: { timezone: 'Europe/Bucharest' },
  })

  await call('/notifications/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: SUBSCRIPTION.endpoint }) })
  expect(await notificationStore.listSubscriptions('user-1')).toHaveLength(0)
})

test('preferences accept valid patches only', async () => {
  const { call } = await setup()
  const ok = await call('/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify({ expiryLeadDays: 5, lowStockEnabled: false }),
  })
  expect(ok.status).toBe(200)
  expect(((await ok.json()) as { preferences: { expiryLeadDays: number } }).preferences.expiryLeadDays).toBe(5)

  expect((await call('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ notifyHour: 99 }) })).status).toBe(400)
  expect((await call('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ expiryEnabled: 'yes' }) })).status).toBe(400)
})

test('household items: none/half/all adjust stock; food is rejected', async () => {
  const { call, products, inventory, notificationStore, householdId, locationId } = await setup()
  const soap = await products.createManualProduct({ householdId, name: 'Dish soap', unit: 'ml' })
  const milk = await products.createManualProduct({ householdId, name: 'Milk', unit: 'ml' })
  await call(`/products/${soap.id}/kind`, { method: 'PUT', body: JSON.stringify({ kind: 'household' }) })

  // Stocking through the API records the "full" reference quantity.
  const stock = await call('/inventory/stock', {
    method: 'POST',
    body: JSON.stringify({ productId: soap.id, locationId, quantity: 1000 }),
  })
  expect(stock.status).toBe(200)
  await inventory.addStock({ householdId, userId: 'user-1', productId: milk.id, locationId, quantity: 1000 })

  const total = async (productId: string) =>
    (await inventory.readLotsForConsumption({ householdId, productId })).reduce((sum, lot) => sum + lot.quantity, 0)

  const half = await call(`/stock-checks/${soap.id}/respond`, { method: 'POST', body: JSON.stringify({ level: 'half' }) })
  expect(half.status).toBe(200)
  expect(await total(soap.id)).toBe(500)

  const full = await call(`/stock-checks/${soap.id}/respond`, { method: 'POST', body: JSON.stringify({ level: 'full' }) })
  expect(full.status).toBe(200)
  expect(await total(soap.id)).toBe(1000)

  const none = await call(`/stock-checks/${soap.id}/respond`, { method: 'POST', body: JSON.stringify({ level: 'none' }) })
  expect(none.status).toBe(200)
  expect(await none.json()).toMatchObject({ level: 'none', totalQuantity: 0, addedToShopping: true })
  expect(await total(soap.id)).toBe(0)
  expect(await notificationStore.getFullQuantity({ householdId, productId: soap.id })).toBe(1000)

  const shopping = (await (await call('/shopping')).json()) as { list: { items: Array<{ productId: string }> } }
  expect(shopping.list.items.map((item) => item.productId)).toContain(soap.id)

  const food = await call(`/stock-checks/${milk.id}/respond`, { method: 'POST', body: JSON.stringify({ level: 'none' }) })
  expect(food.status).toBe(400)
  expect(await total(milk.id)).toBe(1000)

  expect(
    (await call(`/stock-checks/${soap.id}/respond`, { method: 'POST', body: JSON.stringify({ level: 'lots' }) })).status,
  ).toBe(400)
})

test('a user cannot answer for a household they do not belong to', async () => {
  const { call, householdId, products } = await setup()
  const soap = await products.createManualProduct({ householdId, name: 'Soap', unit: 'each' })
  const res = await call(`/stock-checks/${soap.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ level: 'none', householdId: 'someone-elses-home' }),
  })
  expect(res.status).toBe(404)
})

test('the daily cycle sends expiry, low-stock and stock-check pushes once', async () => {
  const { env, call, sent, products, inventory, notificationStore, householdId, locationId } = await setup()
  await call('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(SUBSCRIPTION) })
  await notificationStore.setPreferences('user-1', { timezone: 'UTC', notifyHour: 0 })

  const milk = await products.createManualProduct({ householdId, name: 'Milk', unit: 'each' })
  const soap = await products.createManualProduct({ householdId, name: 'Soap', unit: 'each' })
  await notificationStore.setProductKind({ householdId, productId: soap.id, kind: 'household' })
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await inventory.addStock({ householdId, userId: 'user-1', productId: milk.id, locationId, quantity: 1, expiresOn: tomorrow })
  await inventory.setMinimumQuantity({ householdId, productId: milk.id, minimumQuantity: 2 })
  await inventory.addStock({ householdId, userId: 'user-1', productId: soap.id, locationId, quantity: 2 })

  const deps = { notifications: notificationStore, inventory, send: env.PUSH_SENDER }
  const later = new Date(Date.now() + 15 * 86_400_000)
  // 15 days on: the milk is long expired, soap check is due.
  const nowInRange = new Date(Date.now() + 3_600_000)
  const first = await runNotificationCycle(deps, nowInRange)
  expect(first.sent).toBe(2)
  const kinds = sent.map((message) => (message.payload.data as { kind: string }).kind).sort()
  expect(kinds).toEqual(['expiry', 'low_stock'])

  // Same local day: nothing more is sent.
  const again = await runNotificationCycle(deps, nowInRange)
  expect(again.sent).toBe(0)

  // Later: the soap stock check goes out with none / half / all buttons.
  sent.length = 0
  const check = await runNotificationCycle(deps, later)
  const stockCheck = sent.find((message) => (message.payload.data as { kind: string }).kind === 'stock_check')
  expect(stockCheck?.payload.actions).toEqual([
    { action: 'none', title: 'Nimic' },
    { action: 'full', title: 'Tot' },
  ])
  expect(check.sent).toBeGreaterThanOrEqual(1)
})

test('dead subscriptions are removed when the push service reports them gone', async () => {
  const { env, call, notificationStore } = await setup()
  await call('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(SUBSCRIPTION) })
  const gone = { ...env, PUSH_SENDER: async () => ({ ok: false as const, gone: true }) }
  const res = await app.request('/api/v1/notifications/test', { method: 'POST' }, gone)
  expect(res.status).toBe(200)
  expect(await notificationStore.listSubscriptions('user-1')).toEqual([])
})
