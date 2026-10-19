import { betterAuth } from 'better-auth'
import { ensureProfile } from '../profiles/profile.js'

function createAuthInstance(env: CloudflareBindings) {
  return betterAuth({
    appName: 'Pantry',
    // Node deployments hand Better Auth the raw SQLite handle (real transactions).
    database: (env.AUTH_DB ?? env.DB) as D1Database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      ...(env.TRUSTED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: env.APP_ENV === 'production' || env.BETTER_AUTH_URL.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await ensureProfile(env.DB, { id: user.id, name: user.name })
            } catch {
              console.error(JSON.stringify({ message: 'ensureProfile after signup failed' }))
            }
          },
        },
      },
    },
  })
}

type Auth = ReturnType<typeof createAuthInstance>

const authByDatabase = new WeakMap<D1Database, Auth>()

export function createAuth(env: CloudflareBindings): Auth {
  const cached = authByDatabase.get(env.DB)
  if (cached) {
    return cached
  }

  const auth = createAuthInstance(env)
  authByDatabase.set(env.DB, auth)
  return auth
}
