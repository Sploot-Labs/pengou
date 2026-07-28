import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '@splootlabs/shared'
import type { Db } from './client.js'
import { schema } from './index.js'

/**
 * Contexte d'accès aux données d'une requête.
 * - `tenantId` : frontière d'isolation DURE entre tenants — toujours appliquée.
 * - `ownerId` (optionnel) : frontière d'isolation intra-tenant par utilisateur.
 *   Présent = « scope utilisateur » : les lectures/écritures d'entités possédées
 *   (quiz, rapports de partie) sont RESTREINTES à ce propriétaire. Construit ainsi
 *   par `requestScope` (routes HTTP) et `host:create` (socket), à partir de
 *   l'utilisateur authentifié. Absent = « scope système » : accès à tout le tenant
 *   (réhydratation moteur au boot, tests unitaires de repo). Un scope sans `ownerId`
 *   ne doit JAMAIS être dérivé d'une entrée client — voir `requestScope`.
 */
export type TenantScope = { db: Db; tenantId: string; ownerId?: string }

/**
 * Erreur typée levée par `resolveTenantId` quand l'utilisateur authentifié n'a pas de
 * membership sur le tenant demandé (mode multi). Exportée pour que la couche HTTP
 * (`apps/server/src/require-user.ts`) puisse la reconnaître par son TYPE plutôt qu'en
 * matchant une sous-chaîne du message d'erreur (couplage fragile à une chaîne française,
 * en plus d'un couplage indésirable de `@splootlabs/server` à la formulation exacte de
 * `@splootlabs/db`).
 */
export class TenantAccessDeniedError extends Error {
  constructor(message = 'accès refusé : aucune appartenance à ce tenant') {
    super(message)
    this.name = 'TenantAccessDeniedError'
  }
}

export function tenantScope(db: Db, tenantId: string, ownerId?: string): TenantScope {
  return { db, tenantId, ownerId }
}

export const DEFAULT_TENANT_NAME = 'default'

export async function ensureDefaultTenant(db: Db): Promise<string> {
  const [existing] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.name, DEFAULT_TENANT_NAME))
    .limit(1)
  if (existing) return existing.id
  const [created] = await db
    .insert(schema.tenant)
    .values({ name: DEFAULT_TENANT_NAME })
    .onConflictDoNothing({ target: schema.tenant.name })
    .returning({ id: schema.tenant.id })
  if (created) return created.id
  // course concurrente : relire
  const [row] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.name, DEFAULT_TENANT_NAME))
    .limit(1)
  return row.id
}

export async function ensureMembership(
  db: Db,
  userId: string,
  tenantId: string,
  role: 'owner' | 'admin' | 'member' = 'owner',
): Promise<void> {
  await db.insert(schema.membership)
    .values({ userId, tenantId, role })
    .onConflictDoNothing({ target: [schema.membership.userId, schema.membership.tenantId] })
}

/**
 * Résout le tenant applicable à la requête courante.
 * - mode single : ignore `opts`, renvoie (et crée si besoin) le tenant par défaut.
 * - mode multi : exige `explicitTenantId` ET `userId`, et vérifie qu'une
 *   `membership(userId, explicitTenantId)` existe (sinon lève « accès refusé »).
 *
 * RUPTURE D'API (intra-projet, Plan 2 → Plan 3) : la signature était
 * `(db, config, explicitTenantId?: string)`. Elle devient
 * `(db, config, opts: { userId?; explicitTenantId? })` pour permettre la
 * validation du membership en mode multi. Tous les appelants ont été mis à jour.
 */
export async function resolveTenantId(
  db: Db,
  config: Pick<AppConfig, 'tenancyMode'>,
  opts: { userId?: string; explicitTenantId?: string } = {},
): Promise<string> {
  if (config.tenancyMode === 'single') return ensureDefaultTenant(db)
  const { userId, explicitTenantId } = opts
  if (!explicitTenantId) throw new Error('mode multi : un tenant explicite est requis')
  if (!userId) throw new Error('mode multi : utilisateur requis')
  const [m] = await db.select({ id: schema.membership.id }).from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.tenantId, explicitTenantId))).limit(1)
  if (!m) throw new TenantAccessDeniedError()
  return explicitTenantId
}
