import { join, resolve } from 'node:path'

export type ServerConfig = {
  port: number
  host: string
  production: boolean
  dataDir: string
  dbPath: string
  assetsDir: string
  backupsDir: string
  staticDir: string
  authSecret: string
  publicUrl: string
  trustedOrigins: string[]
  trustedProxyHops: number
  geminiApiKey: string | undefined
  aiModel: string
  receiptAiModel: string
  vapidPublicKey: string | undefined
  vapidPrivateKey: string | undefined
  vapidSubject: string
  backupKeep: number
  notificationHourUtc: number
}

const PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-32-plus-character-local-secret',
  'changeme',
  'secret',
])

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value == null || value.trim() === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer env value "${value}" (expected ${min}-${max})`)
  }
  return parsed
}

/** Railway exposes the public domain as RAILWAY_PUBLIC_DOMAIN (no scheme). */
function resolvePublicUrl(env: NodeJS.ProcessEnv, production: boolean): string {
  const explicit = env.BETTER_AUTH_URL?.trim() || env.APP_URL?.trim()
  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim()
  const raw = explicit || (railway ? `https://${railway}` : production ? '' : 'http://localhost:8080')
  if (!raw) {
    throw new Error('BETTER_AUTH_URL is required (or generate a Railway domain so RAILWAY_PUBLIC_DOMAIN is set)')
  }
  const url = new URL(raw)
  if (production && url.protocol !== 'https:') {
    throw new Error('BETTER_AUTH_URL must use https in production')
  }
  return url.origin
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT != null
  const authSecret = env.BETTER_AUTH_SECRET?.trim() ?? ''
  if (authSecret.length < 32 || PLACEHOLDER_SECRETS.has(authSecret)) {
    throw new Error('BETTER_AUTH_SECRET must be a unique random string of at least 32 characters (openssl rand -base64 32)')
  }

  const publicUrl = resolvePublicUrl(env, production)
  const dataDir = resolve(env.DATA_DIR?.trim() || (production ? '/data' : './data'))
  const trustedOrigins = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin)

  return {
    port: int(env.PORT, 8080, 1, 65535),
    host: env.HOST?.trim() || '0.0.0.0',
    production,
    dataDir,
    dbPath: join(dataDir, 'pantry.db'),
    assetsDir: join(dataDir, 'assets'),
    backupsDir: join(dataDir, 'backups'),
    staticDir: resolve(env.STATIC_DIR?.trim() || 'dist/client'),
    authSecret,
    publicUrl,
    trustedOrigins,
    trustedProxyHops: int(env.TRUSTED_PROXY_HOPS, 1, 0, 5),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    aiModel: env.AI_MODEL?.trim() || 'gemini-2.5-flash',
    receiptAiModel: env.RECEIPT_AI_MODEL?.trim() || 'gemini-2.5-flash',
    vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || undefined,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY?.trim() || undefined,
    vapidSubject: env.VAPID_SUBJECT?.trim() || `mailto:admin@${new URL(publicUrl).hostname}`,
    backupKeep: int(env.BACKUP_KEEP, 7, 0, 90),
    notificationHourUtc: int(env.NOTIFICATION_HOUR_UTC, 7, 0, 23),
  }
}
