import type { Context, MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { ServerConfig } from './config.js'

type NodeBindings = { incoming?: { socket?: { remoteAddress?: string } } }

/**
 * Client IP behind `hops` trusted reverse proxies (Railway = 1). Entries added
 * by the client sit to the left of the trusted ones, so count from the right.
 */
export function clientIp(c: Context, hops: number): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded && hops > 0) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean)
    const picked = parts[Math.max(0, parts.length - hops)]
    if (picked) {
      return picked
    }
  }
  return (c.env as NodeBindings | undefined)?.incoming?.socket?.remoteAddress ?? 'unknown'
}

export function securityHeaders(config: ServerConfig): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // React sets inline style attributes; stylesheets themselves are same-origin.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://images.openfoodfacts.org',
        'https://static.openfoodfacts.org',
        'https://images.openproductsfacts.org',
        'https://static.openproductsfacts.org',
      ],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: config.production ? 'max-age=63072000; includeSubDomains' : false,
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    permissionsPolicy: { camera: ['self'], microphone: [], geolocation: [], payment: [] },
  })
}

/**
 * CSRF defence for cookie-authenticated mutations: browsers always send Origin
 * on cross-site POST/PUT/PATCH/DELETE, so reject when it is not ours.
 */
export function originGuard(config: ServerConfig): MiddlewareHandler {
  const allowed = new Set([config.publicUrl, ...config.trustedOrigins])
  return async (c, next) => {
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const origin = c.req.header('origin')
      if (origin) {
        if (!allowed.has(origin)) {
          return c.json({ error: 'Forbidden' }, 403)
        }
      } else if (c.req.header('sec-fetch-site') === 'cross-site') {
        return c.json({ error: 'Forbidden' }, 403)
      }
    }
    await next()
  }
}

type Bucket = { count: number; resetAt: number }

/** Fixed-window in-memory limiter. One Railway instance, so no shared store needed. */
export function rateLimit(options: {
  name: string
  limit: number
  windowMs: number
  hops: number
  methods?: string[]
}): MiddlewareHandler {
  const buckets = new Map<string, Bucket>()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key)
      }
    }
  }, options.windowMs)
  sweep.unref()

  return async (c, next) => {
    if (options.methods && !options.methods.includes(c.req.method)) {
      return next()
    }
    const now = Date.now()
    const key = clientIp(c, options.hops)
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    if (bucket.count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'RATE_LIMITED', retryAfter }, 429)
    }
    await next()
  }
}
