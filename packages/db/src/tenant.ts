import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '@splootlabs/shared'
import type { Db } from './client.js'
import { schema } from './index.js'

export type TenantScope = { db: Db; tenantId: string }

export function tenantScope(db: Db, tenantId: string): TenantScope {
  return { db, tenantId }
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
  if (!m) throw new Error('accès refusé : aucune appartenance à ce tenant')
  return explicitTenantId
}
