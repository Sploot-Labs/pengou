import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from '@splootlabs/db'
import { schema, ensureDefaultTenant, ensureMembership, firstMembershipRole, createWorkspace } from '@splootlabs/db'

export type AuthConfig = {
  secret: string
  baseURL: string
  tenancyMode?: 'single' | 'multi'
  nodeEnv?: 'development' | 'test' | 'production'
  /** Self-host : coupe l'inscription publique (les comptes existants se connectent toujours). */
  disableSignup?: boolean
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
}

/** Nom du workspace personnel créé au signup multi : nom d'affichage s'il est non vide, sinon la
 * partie locale de l'e-mail, sinon un repli générique. Le slug unique est dérivé par `createWorkspace`. */
function personalWorkspaceName(user: { name?: string | null; email?: string | null }): string {
  const name = user.name?.trim()
  if (name) return name
  const local = user.email?.split('@')[0]?.trim()
  if (local) return local
  return 'Mon espace'
}

export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.secret,
    baseURL: config.baseURL,
    emailAndPassword: { enabled: true, disableSignUp: config.disableSignup ?? false },
    // Sécurité (P2) : cookie de session `Secure` dès que l'URL publique est en HTTPS.
    // En production, servez impérativement Pingou derrière HTTPS et fixez BETTER_AUTH_URL
    // en https:// (sinon le cookie de session pourrait transiter en clair). httpOnly +
    // sameSite=lax sont déjà les défauts Better Auth.
    advanced: {
      useSecureCookies: config.baseURL.startsWith('https://'),
    },
    // Sécurité (P1) : anti-brute-force / credential stuffing sur /api/auth/*. Actif en dev ET en
    // prod, désactivé seulement en test (les suites enchaînent volontairement les requêtes) et
    // si `nodeEnv` est absent (contexte de test construisant l'auth sans le préciser). On NE gate
    // PAS sur `=== 'production'` seul : `loadConfig` fait défaut `NODE_ENV` à 'development' (jamais
    // undefined côté serveur réel), donc un déploiement avec NODE_ENV non mis à 'production'
    // resterait protégé (pas de fail-open). Fenêtre glissante en mémoire — suffisant en
    // mono-instance ; à externaliser (secondary storage) lors d'un passage multi-instance.
    rateLimit: {
      enabled: config.nodeEnv === 'development' || config.nodeEnv === 'production',
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
              // Défaut de rôle (Slice 1) : 1er membre du tenant = owner, suivants = member.
              const role = await firstMembershipRole(db, tenantId)
              await ensureMembership(db, user.id, tenantId, role)
              return
            }
            // Multi (Slice 3) : chaque inscription obtient un workspace personnel dont elle est
            // owner — pas d'état « aucun workspace ». Nom dérivé du nom d'affichage, à défaut de la
            // partie locale de l'e-mail. L'utilisateur pourra créer/rejoindre d'autres workspaces.
            const label = personalWorkspaceName(user)
            await createWorkspace(db, { name: label, ownerId: user.id })
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
