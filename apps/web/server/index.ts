import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { runMigrations, sqliteAsD1 } from '@pantry/database/sqlite'
import { app as api } from '../worker/index.js'
import { loadConfig } from './config.js'
import { createFsBucket } from './fs-bucket.js'
import { startBackups } from './backup.js'
import { createPushSender } from './push.js'
import { startNotificationScheduler } from './scheduler.js'
import { originGuard, rateLimit, securityHeaders } from './security.js'

const config = loadConfig()

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
const sqlite = new DatabaseSync(config.dbPath)
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA synchronous = NORMAL')
sqlite.exec('PRAGMA busy_timeout = 5000')
sqlite.exec('PRAGMA foreign_keys = ON')
// The build copies the SQL files next to the bundle; fall back to the repo copy in dev.
const bundledMigrations = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const migrationsDir = existsSync(bundledMigrations)
  ? bundledMigrations
  : join(process.cwd(), '../../packages/database/migrations')
const applied = runMigrations(sqlite, migrationsDir)
if (applied.length > 0) {
  console.log(JSON.stringify({ message: 'migrations applied', files: applied }))
}

// Better Auth runs interactive transactions, so it gets its own connection.
// WAL + busy_timeout let both connections share the file safely.
const authSqlite = new DatabaseSync(config.dbPath)
authSqlite.exec('PRAGMA busy_timeout = 5000')
authSqlite.exec('PRAGMA foreign_keys = ON')

const d1 = sqliteAsD1(sqlite) as unknown as D1Database
const pushSender = createPushSender(config)
const bindings = {
  DB: d1,
  AUTH_DB: authSqlite,
  R2: createFsBucket(config.assetsDir),
  BETTER_AUTH_SECRET: config.authSecret,
  BETTER_AUTH_URL: config.publicUrl,
  TRUSTED_ORIGINS: config.trustedOrigins.join(','),
  APP_ENV: config.production ? 'production' : 'development',
  GEMINI_API_KEY: config.geminiApiKey ?? '',
  AI_MODEL: config.aiModel as 'gemini-2.5-flash',
  RECEIPT_AI_MODEL: config.receiptAiModel as 'gemini-2.5-flash',
  VAPID_PUBLIC_KEY: config.vapidPublicKey,
  VAPID_PRIVATE_KEY: config.vapidPrivateKey,
  VAPID_SUBJECT: config.vapidSubject,
  PUSH_SENDER: pushSender,
} satisfies Partial<CloudflareBindings> as unknown as CloudflareBindings

const server = new Hono()
server.use('*', securityHeaders(config))
server.use('*', compress())
server.use('/api/*', originGuard(config))
server.use(
  '/api/auth/sign-in/*',
  rateLimit({ name: 'sign-in', limit: 10, windowMs: 60_000, hops: config.trustedProxyHops, methods: ['POST'] }),
)
server.use(
  '/api/auth/sign-up/*',
  rateLimit({ name: 'sign-up', limit: 5, windowMs: 60_000, hops: config.trustedProxyHops, methods: ['POST'] }),
)
server.use(
  '/api/auth/*',
  rateLimit({ name: 'auth', limit: 60, windowMs: 60_000, hops: config.trustedProxyHops }),
)
server.use(
  '/api/v1/receipts/*',
  rateLimit({ name: 'receipts', limit: 20, windowMs: 60_000, hops: config.trustedProxyHops }),
)
server.use(
  '/api/v1/ai/*',
  rateLimit({ name: 'ai', limit: 20, windowMs: 60_000, hops: config.trustedProxyHops }),
)
server.use(
  '/api/v1/*',
  rateLimit({ name: 'api', limit: 300, windowMs: 60_000, hops: config.trustedProxyHops }),
)
// Largest legitimate upload is a 3 MB product photo; leave multipart overhead.
server.use(
  '/api/*',
  bodyLimit({
    maxSize: 4 * 1024 * 1024,
    onError: (c) => c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413),
  }),
)
server.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

server.all('/api/*', (c) => api.fetch(c.req.raw, { ...bindings, ...(c.env as object) }))

// Static client. Hashed assets are immutable; the shell and service worker must revalidate.
server.use('*', async (c, next) => {
  await next()
  if (!c.res.headers.has('Cache-Control')) {
    c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  }
})
server.use('*', serveStatic({ root: config.staticDir }))
server.get('*', async (c, next) => {
  // Real files that are missing must 404; only client routes fall back to the SPA shell.
  if (/\.[A-Za-z0-9]{1,8}$/.test(c.req.path)) {
    return c.text('Not found', 404)
  }
  return (await serveStatic({ root: config.staticDir, path: 'index.html' })(c, next)) ?? c.res
})

server.onError((error, c) => {
  console.error(JSON.stringify({ message: 'unhandled error', name: error.name }))
  return c.json({ error: 'Internal Server Error' }, 500)
})

const httpServer = serve({ fetch: server.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(JSON.stringify({ message: 'pantry listening', port: info.port, env: bindings.APP_ENV }))
})

const stopBackups = startBackups(sqlite, config)
const stopScheduler = startNotificationScheduler({ db: d1, send: pushSender })

function shutdown(signal: string) {
  console.log(JSON.stringify({ message: 'shutting down', signal }))
  stopScheduler()
  stopBackups()
  httpServer.close(() => {
    try {
      sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      authSqlite.close()
      sqlite.close()
    } finally {
      process.exit(0)
    }
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
