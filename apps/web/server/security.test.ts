import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import { loadConfig } from './config.js'
import { originGuard, rateLimit } from './security.js'

const baseEnv = {
  BETTER_AUTH_SECRET: 'a-unique-secret-that-is-at-least-32-chars',
  BETTER_AUTH_URL: 'https://pantry.example.com',
  DATA_DIR: '/tmp/pantry-test',
} as NodeJS.ProcessEnv

describe('loadConfig', () => {
  test('rejects short or placeholder secrets', () => {
    expect(() => loadConfig({ ...baseEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/)
    expect(() =>
      loadConfig({ ...baseEnv, BETTER_AUTH_SECRET: 'replace-with-a-32-plus-character-local-secret' }),
    ).toThrow(/BETTER_AUTH_SECRET/)
  })

  test('requires https in production', () => {
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: 'production', BETTER_AUTH_URL: 'http://pantry.example.com' }),
    ).toThrow(/https/)
  })

  test('derives the public url from the Railway domain', () => {
    const config = loadConfig({
      ...baseEnv,
      BETTER_AUTH_URL: undefined,
      RAILWAY_PUBLIC_DOMAIN: 'pantry-production.up.railway.app',
    })
    expect(config.publicUrl).toBe('https://pantry-production.up.railway.app')
    expect(config.production).toBe(false)
  })
})

describe('originGuard', () => {
  const config = loadConfig(baseEnv)
  const app = new Hono()
  app.use('*', originGuard(config))
  app.get('/x', (c) => c.text('ok'))
  app.post('/x', (c) => c.text('ok'))

  test('blocks cross-origin mutations', async () => {
    const res = await app.request('/x', { method: 'POST', headers: { origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })

  test('allows same-origin mutations, non-browser clients and reads', async () => {
    expect((await app.request('/x', { method: 'POST', headers: { origin: config.publicUrl } })).status).toBe(200)
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/x', { headers: { origin: 'https://evil.example' } })).status).toBe(200)
    expect(
      (await app.request('/x', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status,
    ).toBe(403)
  })
})

describe('rateLimit', () => {
  test('limits per client ip using the trusted proxy entry', async () => {
    const app = new Hono()
    app.use('*', rateLimit({ name: 't', limit: 2, windowMs: 60_000, hops: 1 }))
    app.get('/x', (c) => c.text('ok'))
    const call = (ip: string) => app.request('/x', { headers: { 'x-forwarded-for': `1.1.1.1, ${ip}` } })

    expect((await call('9.9.9.9')).status).toBe(200)
    expect((await call('9.9.9.9')).status).toBe(200)
    const blocked = await call('9.9.9.9')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
    expect((await call('8.8.8.8')).status).toBe(200)
  })
})
