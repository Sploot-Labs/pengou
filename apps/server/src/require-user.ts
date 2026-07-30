import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import { resolveTenantId, getMembershipRole, TenantAccessDeniedError, type Db } from '@splootlabs/db'
import { hasPermission, type AppConfig } from '@splootlabs/shared'
import type { Auth } from '@splootlabs/auth'

declare module 'fastify' {
  interface FastifyRequest { user: { id: string; email: string } }
  interface FastifyInstance { auth: Auth }
}

/** Contexte tenant résolu pour une requête : le tenant applicable + `ownerId` role-aware
 * (owner/admin → undefined = tout le tenant ; member → son userId). Utilisé pour construire
 * un scope RLS via `withTenantTx(appDb, context, …)`. */
export type TenantContext = { tenantId: string; ownerId?: string }

export function registerRequireUser(app: FastifyInstance, auth: Auth): void {
  if (!app.hasDecorator('auth')) app.decorate('auth', auth)
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await request.server.auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
  if (!session?.user) { reply.code(401).send({ error: 'Non authentifié.' }); return }
  request.user = { id: session.user.id, email: session.user.email }
}

/**
 * Résout le contexte tenant de la requête via la connexion PRIVILÉGIÉE (`systemDb`) : le
 * tenant applicable (mode single/multi) puis le rôle → `ownerId` role-aware. La résolution du
 * membership est PRÉ-contexte (elle détermine le tenant) → elle ne passe pas par le RLS.
 * Le travail scopé se fait ensuite dans `withTenantTx(appDb, context, …)`.
 *
 * Invariant : suppose que `requireUser` a déjà renseigné `request.user` (garde défensive).
 */
export async function resolveTenantContext(
  request: FastifyRequest,
  systemDb: Db,
  config: AppConfig,
): Promise<TenantContext> {
  if (!request.user?.id) throw new Error('resolveTenantContext requires requireUser preHandler')
  const explicitTenantId = typeof request.headers['x-tenant-id'] === 'string' ? (request.headers['x-tenant-id'] as string) : undefined
  const tenantId = await resolveTenantId(systemDb, config, { userId: request.user.id, explicitTenantId })
  const role = (await getMembershipRole(systemDb, request.user.id, tenantId)) ?? 'member'
  const ownerId = hasPermission(role, 'content:access-all') ? undefined : request.user.id
  return { tenantId, ownerId }
}

/**
 * Résout le contexte, ou répond 403 et renvoie `null` — UNIQUEMENT pour « pas de membership »
 * (`TenantAccessDeniedError`, mode multi). Toute autre erreur est relancée (→ 500 Fastify),
 * jamais masquée en 403. Match sur le TYPE de l'erreur, pas sur son message.
 */
export async function resolveContextOr403(
  request: FastifyRequest,
  reply: FastifyReply,
  systemDb: Db,
  config: AppConfig,
): Promise<TenantContext | null> {
  try {
    return await resolveTenantContext(request, systemDb, config)
  } catch (e) {
    if (e instanceof TenantAccessDeniedError) {
      reply.code(403).send({ error: 'Accès refusé à ce tenant.' })
      return null
    }
    throw e
  }
}
