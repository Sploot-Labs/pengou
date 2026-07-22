import { eq } from 'drizzle-orm'
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
    .onConflictDoNothing()
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

export async function resolveTenantId(
  db: Db,
  config: Pick<AppConfig, 'tenancyMode'>,
  explicitTenantId?: string,
): Promise<string> {
  if (config.tenancyMode === 'single') return ensureDefaultTenant(db)
  if (!explicitTenantId) throw new Error('mode multi : un tenant explicite est requis')
  return explicitTenantId
}
