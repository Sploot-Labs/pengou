export { createDb, type Db } from './client.js'
export { runMigrations } from './migrate.js'
export {
  tenantScope, type TenantScope, ensureDefaultTenant, resolveTenantId, DEFAULT_TENANT_NAME,
} from './tenant.js'
export * as schema from './schema.js'
