import { Hono } from 'hono'
import { resolveCurrentUser } from '../auth/session.js'
import { ensureProfile, isSupportedLocale, updateProfileLocale } from '../profiles/profile.js'

export const profile = new Hono<{ Bindings: CloudflareBindings }>()

profile.get('/profile', async (c) => {
  const user = await resolveCurrentUser(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const current = await ensureProfile(c.env.DB, user)
  return c.json({
    id: current.id,
    displayName: current.displayName,
    avatarUrl: current.avatarUrl,
    locale: current.locale,
  })
})

profile.patch('/profile', async (c) => {
  const user = await resolveCurrentUser(c.env, c.req.raw)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body: unknown = await c.req.json().catch(() => null)
  const locale = body && typeof body === 'object' ? (body as { locale?: unknown }).locale : undefined
  if (!isSupportedLocale(locale)) {
    return c.json({ error: 'Invalid locale' }, 400)
  }

  await ensureProfile(c.env.DB, user)
  await updateProfileLocale(c.env.DB, user.id, locale)
  return c.json({ locale })
})
