import type { Db } from './client.js'

export type TenantScope = { db: Db; tenantId: string }

export function tenantScope(db: Db, tenantId: string): TenantScope {
  return { db, tenantId }
}
