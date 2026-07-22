import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from '@splootlabs/db'
import { schema, ensureDefaultTenant, ensureMembership } from '@splootlabs/db'

export type AuthConfig = {
  secret: string
  baseURL: string
  tenancyMode?: 'single' | 'multi'
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
}

export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.secret,
    baseURL: config.baseURL,
    emailAndPassword: { enabled: true },
    socialProviders: config.socialProviders ?? {},
    databaseHooks: {
      user: {
        create: {
          // Better Auth v1.6.24 (@better-auth/core init-options.ts) : la signature réelle
          // est `after?: (user, context: GenericEndpointContext | null) => Promise<void>`
          // (un 2e paramètre contexte, non utilisé ici) — conforme au brief.
          after: async (user) => {
            if ((config.tenancyMode ?? 'single') === 'single') {
              const tenantId = await ensureDefaultTenant(db)
              await ensureMembership(db, user.id, tenantId)
            }
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
