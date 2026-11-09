import { and, eq } from 'drizzle-orm'
import type { Role } from '@splootlabs/shared'
import type { Db } from '../client.js'
import type { TenantScope } from '../tenant.js'
import { schema } from '../index.js'

/**
 * Invitations (Slice 3). Deux familles d'opérations :
 * - SCOPÉES tenant (create/list/get/revoke/resend) : tournent sur appDb dans `withTenantTx`
 *   (sous RLS, `tenant_id` = contexte). Prennent un `TenantScope`.
 * - PRÉ-contexte par token (getByToken/accept) : tournent sur `systemDb` (bypass RLS), gardées
 *   par le token bearer. Prennent un `Db`. On ne peut pas exiger un contexte tenant pour un
 *   destinataire qui n'en est pas encore membre.
 */

export type Invitation = typeof schema.invitation.$inferSelect

/** 7 jours (cf. spec). */
export const INVITATION_TTL_MS = 7 * 24 * 3600_000

/** Token opaque URL-safe (uuid v4 sans tirets → 32 hex). */
export function newInvitationToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function invitationExpiry(nowMs: number = Date.now()): Date {
  return new Date(nowMs + INVITATION_TTL_MS)
}

export async function createInvitation(
  scope: TenantScope,
  input: { email: string; role: Role; invitedBy: string; token: string; expiresAt: Date },
): Promise<Invitation> {
  const [row] = await scope.db
    .insert(schema.invitation)
    .values({
      tenantId: scope.tenantId, // toujours le tenant du scope, jamais depuis l'input
      email: input.email,
      role: input.role,
      invitedBy: input.invitedBy,
      token: input.token,
      expiresAt: input.expiresAt,
    })
    .returning()
  return row
}

/** Invitations du tenant courant ; par défaut seulement `pending`. */
export async function listInvitations(
  scope: TenantScope,
  opts: { status?: 'pending' | 'accepted' | 'revoked' } = { status: 'pending' },
): Promise<Invitation[]> {
  const status = opts.status
  return scope.db
    .select()
    .from(schema.invitation)
    .where(
      status
        ? and(eq(schema.invitation.tenantId, scope.tenantId), eq(schema.invitation.status, status))
        : eq(schema.invitation.tenantId, scope.tenantId),
    )
    .orderBy(schema.invitation.createdAt)
}

export async function getInvitationById(scope: TenantScope, id: string): Promise<Invitation | null> {
  const [row] = await scope.db
    .select()
    .from(schema.invitation)
    .where(and(eq(schema.invitation.id, id), eq(schema.invitation.tenantId, scope.tenantId)))
    .limit(1)
  return row ?? null
}

/** Révoque une invitation `pending` → `revoked`. Renvoie la ligne, ou null si absente / déjà
 * consommée (statut ≠ pending). */
export async function revokeInvitation(scope: TenantScope, id: string): Promise<Invitation | null> {
  const [row] = await scope.db
    .update(schema.invitation)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(schema.invitation.id, id),
        eq(schema.invitation.tenantId, scope.tenantId),
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .returning()
  return row ?? null
}

/** Renvoie une invitation `pending` : régénère token + expiration. Renvoie la ligne mise à jour, ou
 * null si absente / non pending. */
export async function resendInvitation(
  scope: TenantScope,
  id: string,
  input: { token: string; expiresAt: Date },
): Promise<Invitation | null> {
  const [row] = await scope.db
    .update(schema.invitation)
    .set({ token: input.token, expiresAt: input.expiresAt })
    .where(
      and(
        eq(schema.invitation.id, id),
        eq(schema.invitation.tenantId, scope.tenantId),
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .returning()
  return row ?? null
}

export type InvitationWithWorkspace = Invitation & { workspaceName: string; workspaceSlug: string }

/** Résout une invitation par son token (systemDb, pré-contexte), avec le nom/slug du workspace
 * pour l'écran d'aperçu. Null si le token est inconnu. */
export async function getInvitationByToken(db: Db, token: string): Promise<InvitationWithWorkspace | null> {
  const [row] = await db
    .select({
      id: schema.invitation.id,
      tenantId: schema.invitation.tenantId,
      email: schema.invitation.email,
      role: schema.invitation.role,
      token: schema.invitation.token,
      invitedBy: schema.invitation.invitedBy,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      acceptedAt: schema.invitation.acceptedAt,
      createdAt: schema.invitation.createdAt,
      workspaceName: schema.tenant.name,
      workspaceSlug: schema.tenant.slug,
    })
    .from(schema.invitation)
    .innerJoin(schema.tenant, eq(schema.tenant.id, schema.invitation.tenantId))
    .where(eq(schema.invitation.token, token))
    .limit(1)
  return row ?? null
}

export type AcceptCode = 'not_found' | 'not_pending' | 'expired' | 'already_member'

/** Erreur typée d'acceptation, mappée en code HTTP par la route. */
export class InvitationError extends Error {
  readonly code: AcceptCode
  constructor(code: AcceptCode) {
    super(`invitation: ${code}`)
    this.name = 'InvitationError'
    this.code = code
  }
}

/**
 * Accepte une invitation par token pour `userId` (systemDb, pré-contexte, transaction). Valide
 * l'état (pending, non expirée), refuse si l'utilisateur est déjà membre, crée la membership avec
 * le rôle invité et marque l'invitation `accepted`. Renvoie le tenant rejoint + le rôle.
 */
export async function acceptInvitation(
  db: Db,
  input: { token: string; userId: string; nowMs?: number },
): Promise<{ tenantId: string; role: Role }> {
  const nowMs = input.nowMs ?? Date.now()
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.invitation).where(eq(schema.invitation.token, input.token)).limit(1)
    if (!inv) throw new InvitationError('not_found')
    if (inv.status !== 'pending') throw new InvitationError('not_pending')
    if (inv.expiresAt.getTime() < nowMs) throw new InvitationError('expired')

    const [existing] = await tx
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(and(eq(schema.membership.userId, input.userId), eq(schema.membership.tenantId, inv.tenantId)))
      .limit(1)
    if (existing) throw new InvitationError('already_member')

    await tx.insert(schema.membership).values({ userId: input.userId, tenantId: inv.tenantId, role: inv.role })
    await tx
      .update(schema.invitation)
      .set({ status: 'accepted', acceptedAt: new Date(nowMs) })
      .where(eq(schema.invitation.id, inv.id))
    return { tenantId: inv.tenantId, role: inv.role as Role }
  })
}
