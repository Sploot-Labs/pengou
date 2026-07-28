import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from '@splootlabs/db'
import { schema, ensureDefaultTenant, ensureMembership } from '@splootlabs/db'

export type AuthConfig = {
  secret: string
  baseURL: string
  tenancyMode?: 'single' | 'multi'
  nodeEnv?: 'development' | 'test' | 'production'
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
}

export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.secret,
    baseURL: config.baseURL,
    emailAndPassword: { enabled: true },
    // Sécurité (P2) : cookie de session `Secure` dès que l'URL publique est en HTTPS.
    // En production, servez impérativement Arena derrière HTTPS et fixez BETTER_AUTH_URL
    // en https:// (sinon le cookie de session pourrait transiter en clair). httpOnly +
    // sameSite=lax sont déjà les défauts Better Auth.
    advanced: {
      useSecureCookies: config.baseURL.startsWith('https://'),
    },
    // Sécurité (P1) : anti-brute-force / credential stuffing sur /api/auth/*. Actif en
    // production uniquement (évite de gêner les suites de test qui enchaînent les requêtes).
    // Fenêtre glissante en mémoire — suffisant en mono-instance ; à externaliser (secondary
    // storage) lors d'un passage multi-instance.
    rateLimit: {
      enabled: config.nodeEnv === 'production',
      window: 60,
      max: 20,
    },
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
