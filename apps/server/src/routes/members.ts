import type { FastifyInstance } from 'fastify'
import {
  withTenantTx,
  listMembers,
  getMemberRole,
  countOwners,
  setMemberRole,
  removeMember,
  type Db,
} from '@splootlabs/db'
import { hasPermission, type AppConfig, type Role } from '@splootlabs/shared'
import { requireUser } from '../require-user.js'
import { requirePermission } from '../require-permission.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

const ASSIGNABLE_ROLES: Role[] = ['owner', 'admin', 'member']

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as string[]).includes(value)
}

/**
 * Gestion des membres d'un workspace (Slice 3b). Gardées par `requirePermission('members:manage')`
 * (owner+admin). Le tenant vient du path `:tenantId` ; le travail DB passe par `withTenantTx(appDb)`
 * (sous RLS membership). Gardes fines dans les handlers via `request.workspace.role` (rôle de
 * l'acteur) :
 * - promouvoir/rétrograder VERS ou DEPUIS `owner` exige `workspace:manage` (owner seul) ;
 * - on ne peut jamais rétrograder/retirer le DERNIER owner (garde « ≥ 1 owner »).
 */
export function registerMemberRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb } = deps
  const guard = { preHandler: [requireUser, requirePermission(systemDb, 'members:manage')] }

  app.get<{ Params: { tenantId: string } }>('/api/workspaces/:tenantId/members', guard, async (request) => {
    const { tenantId } = request.workspace!
    const members = await withTenantTx(appDb, { tenantId }, (scope) => listMembers(scope))
    return { members }
  })

  app.patch<{ Params: { tenantId: string; userId: string } }>(
    '/api/workspaces/:tenantId/members/:userId',
    guard,
    async (request, reply) => {
      const actor = request.workspace!
      const targetUserId = request.params.userId
      const body = request.body as { role?: unknown } | undefined
      if (!isRole(body?.role)) {
        return reply.code(400).send({ error: 'Rôle invalide (owner, admin ou member attendu).' })
      }
      const nextRole = body.role

      return withTenantTx(appDb, { tenantId: actor.tenantId }, async (scope) => {
        const currentRole = await getMemberRole(scope, targetUserId)
        if (!currentRole) return reply.code(404).send({ error: 'Membre introuvable.' })

        // Toucher un owner (source ou cible) exige workspace:manage → owner seul.
        const touchesOwner = currentRole === 'owner' || nextRole === 'owner'
        if (touchesOwner && !hasPermission(actor.role, 'workspace:manage')) {
          return reply.code(403).send({ error: 'Seul un owner peut gérer les rôles owner.' })
        }
        // Garde « ≥ 1 owner » : on ne rétrograde pas le dernier owner.
        if (currentRole === 'owner' && nextRole !== 'owner' && (await countOwners(scope)) <= 1) {
          return reply.code(409).send({ error: 'Impossible de rétrograder le dernier owner du workspace.' })
        }
        if (currentRole === nextRole) return { userId: targetUserId, role: nextRole }
        const updated = await setMemberRole(scope, targetUserId, nextRole)
        if (!updated) return reply.code(404).send({ error: 'Membre introuvable.' })
        return updated
      })
    },
  )

  app.delete<{ Params: { tenantId: string; userId: string } }>(
    '/api/workspaces/:tenantId/members/:userId',
    guard,
    async (request, reply) => {
      const actor = request.workspace!
      const targetUserId = request.params.userId

      return withTenantTx(appDb, { tenantId: actor.tenantId }, async (scope) => {
        const currentRole = await getMemberRole(scope, targetUserId)
        if (!currentRole) return reply.code(404).send({ error: 'Membre introuvable.' })
        if (currentRole === 'owner' && !hasPermission(actor.role, 'workspace:manage')) {
          return reply.code(403).send({ error: 'Seul un owner peut retirer un owner.' })
        }
        if (currentRole === 'owner' && (await countOwners(scope)) <= 1) {
          return reply.code(409).send({ error: 'Impossible de retirer le dernier owner du workspace.' })
        }
        const ok = await removeMember(scope, targetUserId)
        if (!ok) return reply.code(404).send({ error: 'Membre introuvable.' })
        return { ok: true }
      })
    },
  )
}
