import { Hono } from 'hono'
import {
  DomainError,
  httpStatusForDomainError,
  isAllowedPushEndpoint,
  isDomainError,
  parseProductKind,
  parseStockLevel,
  type NotificationPreferences,
} from '@pantry/core'
import {
  createD1HouseholdStore,
  createD1InventoryStore,
  createD1NotificationStore,
  createD1ProductStore,
  createD1ShoppingStore,
} from '@pantry/database/d1'
import { requireAuth } from '../auth/authorize.js'
import { ensureProfile } from '../profiles/profile.js'
import { pushToUser } from '../notifications/run.js'
import { applyStockLevel } from '../notifications/stock-level.js'

export const notifications = new Hono<{ Bindings: CloudflareBindings }>()

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function domainResponse(error: DomainError) {
  return {
    body: { error: error.message, code: error.code },
    status: httpStatusForDomainError(error.code),
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = readJsonObject(await request.json().catch(() => null))
  if (!body) {
    throw new DomainError('INVALID_QUANTITY', 'Invalid request body')
  }
  return body
}

function pushSupported(env: CloudflareBindings): boolean {
  return Boolean(env.PUSH_SENDER && env.VAPID_PUBLIC_KEY)
}

async function resolveHouseholdId(env: CloudflareBindings, userId: string, requested: unknown): Promise<string> {
  const households = createD1HouseholdStore(env.DB)
  if (typeof requested === 'string' && requested.trim() !== '') {
    const membership = await households.getMembership(userId, requested.trim())
    if (!membership) {
      throw new DomainError('NOT_FOUND', 'Not found')
    }
    return membership.householdId
  }
  const active = await households.getActiveHousehold(userId)
  if (!active) {
    throw new DomainError('HOUSEHOLD_REQUIRED', 'Household setup required')
  }
  return active.id
}

function stockLevelDeps(env: CloudflareBindings) {
  return {
    households: createD1HouseholdStore(env.DB),
    inventory: createD1InventoryStore(env.DB),
    notifications: createD1NotificationStore(env.DB),
    products: createD1ProductStore(env.DB),
    shopping: createD1ShoppingStore(env.DB),
  }
}

function readPreferencePatch(body: Record<string, unknown>): Partial<NotificationPreferences> {
  const patch: Partial<NotificationPreferences> = {}
  for (const key of ['expiryEnabled', 'lowStockEnabled', 'stockChecksEnabled'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        throw new DomainError('INVALID_PREFERENCES', 'Invalid notification preferences')
      }
      patch[key] = body[key]
    }
  }
  for (const key of ['expiryLeadDays', 'notifyHour'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'number') {
        throw new DomainError('INVALID_PREFERENCES', 'Invalid notification preferences')
      }
      patch[key] = body[key]
    }
  }
  if ('timezone' in body) {
    if (typeof body.timezone !== 'string' || body.timezone.length > 64) {
      throw new DomainError('INVALID_PREFERENCES', 'Invalid notification preferences')
    }
    patch.timezone = body.timezone
  }
  return patch
}

notifications.get('/notifications', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const store = createD1NotificationStore(c.env.DB)
  const [preferences, subscriptions] = await Promise.all([
    store.getPreferences(user.id),
    store.listSubscriptions(user.id),
  ])
  return c.json({
    supported: pushSupported(c.env),
    vapidPublicKey: pushSupported(c.env) ? (c.env.VAPID_PUBLIC_KEY ?? null) : null,
    preferences,
    subscriptionCount: subscriptions.length,
    endpoints: subscriptions.map((subscription) => subscription.endpoint),
  })
})

notifications.put('/notifications/preferences', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    const patch = readPreferencePatch(await readBody(c.req.raw))
    const preferences = await createD1NotificationStore(c.env.DB).setPreferences(user.id, patch)
    return c.json({ preferences })
  } catch (error) {
    if (isDomainError(error)) {
      const mapped = domainResponse(error)
      return c.json(mapped.body, mapped.status)
    }
    throw error
  }
})

notifications.post('/notifications/subscriptions', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  if (!pushSupported(c.env)) {
    return c.json({ error: 'Push notifications are not configured', code: 'PUSH_UNAVAILABLE' }, 503)
  }
  try {
    await ensureProfile(c.env.DB, user)
    const body = await readBody(c.req.raw)
    const keys = readJsonObject(body.keys)
    if (
      typeof body.endpoint !== 'string' ||
      !isAllowedPushEndpoint(body.endpoint) ||
      !keys ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string' ||
      keys.p256dh.length > 256 ||
      keys.auth.length > 64
    ) {
      throw new DomainError('INVALID_PUSH_SUBSCRIPTION', 'Invalid push subscription')
    }
    const store = createD1NotificationStore(c.env.DB)
    await store.upsertSubscription(user.id, {
      endpoint: body.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: c.req.header('user-agent') ?? null,
    })
    if (typeof body.timezone === 'string' && body.timezone.length <= 64) {
      // Best effort: keep the stored zone in step with the device that subscribed.
      await store.setPreferences(user.id, { timezone: body.timezone }).catch(() => undefined)
    }
    return c.json({ ok: true })
  } catch (error) {
    if (isDomainError(error)) {
      const mapped = domainResponse(error)
      return c.json(mapped.body, mapped.status)
    }
    throw error
  }
})

notifications.post('/notifications/unsubscribe', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const body = readJsonObject(await c.req.json().catch(() => null))
  if (!body || typeof body.endpoint !== 'string') {
    return c.json({ error: 'Invalid push subscription', code: 'INVALID_PUSH_SUBSCRIPTION' }, 400)
  }
  await createD1NotificationStore(c.env.DB).removeSubscription({ userId: user.id, endpoint: body.endpoint })
  return c.json({ ok: true })
})

notifications.post('/notifications/test', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  if (!c.env.PUSH_SENDER) {
    return c.json({ error: 'Push notifications are not configured', code: 'PUSH_UNAVAILABLE' }, 503)
  }
  const profile = await ensureProfile(c.env.DB, user)
  const ro = profile.locale !== 'en'
  const result = await pushToUser(
    { notifications: createD1NotificationStore(c.env.DB), send: c.env.PUSH_SENDER },
    user.id,
    {
      title: ro ? 'Notificările Pantry funcționează' : 'Pantry notifications work',
      body: ro ? 'Vei primi aici alerte de expirare și stoc.' : "You'll get expiry and stock alerts here.",
      tag: 'pantry-test',
      url: '/settings',
      data: { kind: 'expiry', lang: ro ? 'ro' : 'en' },
    },
  )
  return c.json(result)
})

notifications.get('/stock-checks', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    const householdId = await resolveHouseholdId(c.env, user.id, undefined)
    const due = await createD1NotificationStore(c.env.DB).listStockChecksDue({ householdId, now: new Date() })
    return c.json({ householdId, items: due })
  } catch (error) {
    if (isDomainError(error)) {
      const mapped = domainResponse(error)
      return c.json(mapped.body, mapped.status)
    }
    throw error
  }
})

notifications.post('/stock-checks/:productId/respond', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    await ensureProfile(c.env.DB, user)
    const body = await readBody(c.req.raw)
    const level = parseStockLevel(body.level)
    const householdId = await resolveHouseholdId(c.env, user.id, body.householdId)
    const result = await applyStockLevel(stockLevelDeps(c.env), {
      householdId,
      userId: user.id,
      productId: c.req.param('productId'),
      level,
    })
    return c.json(result)
  } catch (error) {
    if (isDomainError(error)) {
      const mapped = domainResponse(error)
      return c.json(mapped.body, mapped.status)
    }
    throw error
  }
})

notifications.put('/products/:productId/kind', async (c) => {
  const user = await requireAuth(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    const body = await readBody(c.req.raw)
    const kind = parseProductKind(body.kind)
    const householdId = await resolveHouseholdId(c.env, user.id, undefined)
    const productId = c.req.param('productId')
    const product = await createD1ProductStore(c.env.DB).getReadableProduct({ householdId, productId })
    if (!product) {
      throw new DomainError('NOT_FOUND', 'Not found')
    }
    await createD1NotificationStore(c.env.DB).setProductKind({ householdId, productId, kind })
    return c.json({ productId, kind })
  } catch (error) {
    if (isDomainError(error)) {
      const mapped = domainResponse(error)
      return c.json(mapped.body, mapped.status)
    }
    throw error
  }
})
