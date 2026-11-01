import type { FastifyInstance } from 'fastify'
import {
  withTenantTx, createInvitation, listInvitations, getInvitationById, revokeInvitation,
  resendInvitation, getInvitationByToken, acceptInvitation, newInvitationToken, invitationExpiry,
  InvitationError, type Db,
} from '@splootlabs/db'
import type { AppConfig, Role } from '@splootlabs/shared'
import { requireUser } from '../require-user.js'
import { requirePermission } from '../require-permission.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

// Rôles invitables : jamais `owner` (l'ownership se transfère via PATCH members par un owner).
const INVITABLE_ROLES: Role[] = ['admin', 'member']

function isInvitableRole(value: unknown): value is Role {
  return typeof value === 'string' && (INVITABLE_ROLES as string[]).includes(value)
}

// Validation e-mail volontairement permissive (présence d'un `@` encadré) — la vérité, c'est
// l'acceptation authentifiée ; on borne surtout la longueur.
function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= 254
}

function mapAcceptError(code: string): { status: number; error: string } {
  switch (code) {
    case 'not_found': return { status: 404, error: 'Invitation introuvable.' }
    case 'not_pending': return { status: 409, error: 'Cette invitation a déjà été utilisée ou révoquée.' }
    case 'expired': return { status: 410, error: 'Cette invitation a expiré.' }
    case 'already_member': return { status: 409, error: 'Vous êtes déjà membre de ce workspace.' }
    case 'inviter_revoked': return { status: 409, error: "Cette invitation n'est plus valable." }
    default: return { status: 400, error: 'Invitation invalide.' }
  }
}

/** Vue publique (au porteur du token) d'une invitation. Ne divulgue que ce que le token autorise. */
function publicInvitation(inv: Awaited<ReturnType<typeof getInvitationByToken>>, nowMs: number) {
  if (!inv) return null
  return {
    email: inv.email,
    role: inv.role,
    status: inv.status,
    workspaceName: inv.workspaceName,
    workspaceSlug: inv.workspaceSlug,
    expired: inv.expiresAt.getTime() < nowMs,
    expiresAt: inv.expiresAt,
  }
}

/**
 * Invitations (Slice 3b). Endpoints de GESTION (`:tenantId`) gardés par
 * `requirePermission('members:manage')`, sur appDb+withTenantTx (RLS invitation). Endpoints par
 * TOKEN (preview/accept) gardés par `requireUser` seulement, sur systemDb (pré-contexte, le
 * destinataire n'est pas encore membre). On ne branche PAS d'envoi SMTP : la réponse porte le token
 * (le client construit le lien d'invitation) — l'envoi réel est un branchement ultérieur.
 */
export function registerInvitationRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb } = deps
  const guard = { preHandler: [requireUser, requirePermission(systemDb, 'members:manage')] }

  app.get<{ Params: { tenantId: string } }>('/api/workspaces/:tenantId/invitations', guard, async (request) => {
    const { tenantId } = request.workspace!
    const invitations = await withTenantTx(appDb, { tenantId }, (scope) => listInvitations(scope, { status: 'pending' }))
    return { invitations }
  })

  app.post<{ Params: { tenantId: string } }>('/api/workspaces/:tenantId/invitations', guard, async (request, reply) => {
    const { tenantId } = request.workspace!
    const body = request.body as { email?: unknown; role?: unknown } | undefined
    if (!isEmail(body?.email)) return reply.code(400).send({ error: 'E-mail invalide.' })
    const role: Role = isInvitableRole(body?.role) ? body.role : 'member'

    const token = newInvitationToken()
    const expiresAt = invitationExpiry()
    const invitation = await withTenantTx(appDb, { tenantId }, (scope) =>
      createInvitation(scope, { email: body.email as string, role, invitedBy: request.user.id, token, expiresAt }))
    return reply.code(201).send({ invitation })
  })

  app.post<{ Params: { tenantId: string; id: string } }>(
    '/api/workspaces/:tenantId/invitations/:id/resend', guard, async (request, reply) => {
      const { tenantId } = request.workspace!
      const token = newInvitationToken()
      const expiresAt = invitationExpiry()
      const invitation = await withTenantTx(appDb, { tenantId }, (scope) =>
        resendInvitation(scope, request.params.id, { token, expiresAt }))
      if (!invitation) return reply.code(404).send({ error: 'Invitation en attente introuvable.' })
      return { invitation }
    })

  app.delete<{ Params: { tenantId: string; id: string } }>(
    '/api/workspaces/:tenantId/invitations/:id', guard, async (request, reply) => {
      const { tenantId } = request.workspace!
      const invitation = await withTenantTx(appDb, { tenantId }, async (scope) => {
        const existing = await getInvitationById(scope, request.params.id)
        if (!existing) return null
        return revokeInvitation(scope, request.params.id)
      })
      if (!invitation) return reply.code(404).send({ error: 'Invitation en attente introuvable.' })
      return { ok: true }
    })

  // --- Endpoints par token (pré-contexte, systemDb) ---

  // Aperçu PUBLIC (pas de requireUser) : le token est la capacité (bearer). Permet à un invité qui
  // n'a pas encore de compte de voir dans quel workspace il est invité avant de s'inscrire. Ne
  // divulgue que le strict nécessaire (nom du workspace, e-mail invité, rôle, expiration).
  app.get<{ Params: { token: string } }>('/api/invitations/:token', async (request, reply) => {
    const inv = await getInvitationByToken(systemDb, request.params.token)
    const view = publicInvitation(inv, Date.now())
    if (!view) return reply.code(404).send({ error: 'Invitation introuvable.' })
    return view
  })

  app.post<{ Params: { token: string } }>('/api/invitations/:token/accept', { preHandler: requireUser }, async (request, reply) => {
    try {
      const result = await acceptInvitation(systemDb, { token: request.params.token, userId: request.user.id })
      return reply.code(200).send(result)
    } catch (e) {
      if (e instanceof InvitationError) {
        const { status, error } = mapAcceptError(e.code)
        return reply.code(status).send({ error })
      }
      throw e
    }
  })
}
