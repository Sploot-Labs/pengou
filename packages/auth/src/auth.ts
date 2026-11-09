import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import {
  checkEmailDeliverable,
  DELIVERABILITY_MESSAGES,
  maskTokens,
  recipientDomain,
  resetPasswordMail,
  sendAndLog,
  verifyEmailMail,
  type DnsResolver,
  type Mailer,
  type MailKind,
  type MailLogger,
} from '@splootlabs/mail'
import type { Db } from '@splootlabs/db'
import { schema, ensureDefaultTenant, ensureMembership, firstMembershipRole, createWorkspace } from '@splootlabs/db'
import { applyTermsOnUserCreate } from './terms.js'

export type AuthConfig = {
  secret: string
  baseURL: string
  tenancyMode?: 'single' | 'multi'
  nodeEnv?: 'development' | 'test' | 'production'
  /** Self-host : coupe l'inscription publique (les comptes existants se connectent toujours). */
  disableSignup?: boolean
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
  /** Envoi d'e-mails. Absent ou désactivé (`enabled` faux) : ni réinitialisation ni confirmation. */
  mailer?: Mailer
  /** Nom du transport (`config.mail.transport`), repris dans les journaux d'envoi. */
  mailTransport?: string
  /** Contrôle DNS du domaine à l'inscription (la liste des domaines jetables reste toujours active). */
  emailDomainCheck?: boolean
  /** Résolveur DNS injecté (tests). */
  resolver?: DnsResolver
  /** Force l'activation du limiteur de débit (tests dédiés). */
  rateLimitEnabled?: boolean
  logger?: MailLogger
  /** Version courante des CGU (LEGAL_TERMS_VERSION). Absente : aucune acceptation demandée. */
  termsVersion?: string
}

const silentLogger: MailLogger = { info() {}, warn() {}, error() {} }

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
  const logger = config.logger ?? silentLogger
  const transport = config.mailTransport ?? 'inconnu'
  // Sans envoi réel, aucun hook d'envoi n'est branché : Better Auth refuse alors la demande de
  // réinitialisation et n'envoie pas de confirmation (le web masque ces parcours).
  const mailer = config.mailer?.enabled ? config.mailer : undefined
  // Échec avant l'envoi (rendu du gabarit) : même forme de journal que `sendAndLog`.
  const logRenderFailure = (kind: MailKind, email: string, error: unknown) => {
    const err = maskTokens(error instanceof Error ? error.message : String(error))
    logger.error({ kind, transport, domain: recipientDomain(email), err }, "Échec de l'envoi de l'e-mail")
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.secret,
    baseURL: config.baseURL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: config.disableSignup ?? false,
      ...(mailer && {
        // Envoi non attendu : le temps de réponse dépend le moins possible de l'existence du compte.
        // `sendAndLog` ne lève pas ; le `catch` couvre le rendu du gabarit (garde d'URL).
        sendResetPassword: async ({ user, url }) => {
          void (async () => {
            const rendered = resetPasswordMail({ baseUrl: config.baseURL, url })
            await sendAndLog(mailer, { to: user.email, kind: 'reset-password', ...rendered }, logger, transport)
          })().catch((error: unknown) => logRenderFailure('reset-password', user.email, error))
        },
        resetPasswordTokenExpiresIn: 3600,
        revokeSessionsOnPasswordReset: true,
      }),
    },
    ...(mailer && {
      emailVerification: {
        sendOnSignUp: true,
        expiresIn: 86400,
        autoSignInAfterVerification: true,
        // Attendu par Better Auth pendant l'inscription, après création du compte : un échec est
        // journalisé sans être propagé (le compte existe, l'utilisateur pourra redemander l'e-mail).
        sendVerificationEmail: async ({ user, url }) => {
          try {
            const rendered = verifyEmailMail({ baseUrl: config.baseURL, url })
            await sendAndLog(mailer, { to: user.email, kind: 'verify-email', ...rendered }, logger, transport)
          } catch (error) {
            logRenderFailure('verify-email', user.email, error)
          }
        },
      },
    }),
    hooks: {
      // Contrôle des adresses à l'inscription : domaines jetables, puis (si activé) domaine DNS.
      // Ni à la connexion ni à la demande de réinitialisation (on ne révèle rien, on ne bloque
      // pas un compte existant).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const email: unknown = ctx.body?.email
        if (typeof email !== 'string') return
        const verdict = await checkEmailDeliverable(email, {
          dns: config.emailDomainCheck ?? false,
          resolver: config.resolver,
          logger,
        })
        if (verdict !== 'ok') throw new APIError('BAD_REQUEST', { message: DELIVERABILITY_MESSAGES[verdict] })
      }),
    },
    // Sécurité (P2) : cookie de session `Secure` dès que l'URL publique est en HTTPS.
    // En production, servez impérativement Pengou derrière HTTPS et fixez BETTER_AUTH_URL
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
    // `rateLimitEnabled` force le limiteur pour les tests dédiés. Les règles personnalisées
    // remplacent la règle intégrée de ces chemins (3 par 60 s) : 3 demandes par 10 minutes et par IP.
    rateLimit: {
      enabled: config.rateLimitEnabled ?? (config.nodeEnv === 'development' || config.nodeEnv === 'production'),
      window: 60,
      max: 20,
      customRules: {
        '/request-password-reset': { window: 600, max: 3 },
        '/send-verification-email': { window: 600, max: 3 },
      },
    },
    socialProviders: config.socialProviders ?? {},
    user: {
      // Acceptation des CGU : renseignée uniquement par le serveur (hook `before` ci-dessous et
      // POST /api/legal/accept). `input: false` fait refuser par Better Auth toute valeur envoyée
      // par le client, à l'inscription comme sur /update-user.
      additionalFields: {
        termsVersion: { type: 'string', required: false, input: false },
        termsAcceptedAt: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => applyTermsOnUserCreate(config.termsVersion, user, context),
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
