import type { FastifyRequest, FastifyReply } from 'fastify'
import { getMembershipRole, type Db } from '@splootlabs/db'
import { hasPermission, type Capability, type Role } from '@splootlabs/shared'

declare module 'fastify' {
  interface FastifyRequest {
    /** Contexte workspace résolu par `requirePermission` : le tenant du path (`:tenantId`) et le
     * rôle de l'utilisateur courant dessus. Les handlers l'utilisent pour `withTenantTx` et pour
     * les gardes fines (dernier owner, transfert d'ownership). */
    workspace?: { tenantId: string; role: Role }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * preHandler d'autorisation (Slice 3) : premier consommateur du catalogue de capacités
 * (`members:manage`/`workspace:manage`). À chaîner APRÈS `requireUser`. Résout le tenant depuis le
 * paramètre de route `:tenantId` via `systemDb` (la vérification du membership est pré-contexte,
 * elle ne passe pas par le RLS), vérifie que l'utilisateur possède `cap`, sinon répond 403. En cas
 * de succès, pose `request.workspace = { tenantId, role }`.
 *
 * On ne distingue PAS « non membre » de « membre sans la capacité » dans la réponse (403 générique)
 * pour ne pas divulguer l'existence d'un workspace à un non-membre.
 *
 * Comme `requireUser`, un refus renvoie `reply` pour que Fastify n'exécute jamais le gestionnaire.
 */
export function requirePermission(systemDb: Db, cap: Capability) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    if (!request.user?.id) {
      return reply.code(401).send({ error: 'Non authentifié.' })
    }
    const tenantId = (request.params as { tenantId?: string }).tenantId
    if (!tenantId || !UUID_RE.test(tenantId)) {
      return reply.code(400).send({ error: 'Identifiant de workspace invalide.' })
    }
    const role = await getMembershipRole(systemDb, request.user.id, tenantId)
    if (!role || !hasPermission(role, cap)) {
      return reply.code(403).send({ error: 'Accès refusé à ce workspace.' })
    }
    request.workspace = { tenantId, role }
  }
}
