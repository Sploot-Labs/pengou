import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from '@splootlabs/db'
import { schema } from '@splootlabs/db'

export type AuthConfig = {
  secret: string
  baseURL: string
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
}

export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.secret,
    baseURL: config.baseURL,
    emailAndPassword: { enabled: true },
    socialProviders: config.socialProviders ?? {},
  })
}

export type Auth = ReturnType<typeof createAuth>
