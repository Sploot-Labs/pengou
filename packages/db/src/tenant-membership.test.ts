import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations, schema } from './index.js'
import { ensureMembership, resolveTenantId, ensureDefaultTenant } from './tenant.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantId: string
let userId: string

beforeAll(async () => {
  ctx = await startTestDb(); await runMigrations(ctx.db)
  tenantId = await ensureDefaultTenant(ctx.db)
  const [u] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'm@arena.fr', name: 'M', emailVerified: false })
    .returning()
  userId = u.id
}, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('résolution multi via membership', () => {
  it('multi sans membership → accès refusé', async () => {
    await expect(resolveTenantId(ctx.db, { tenancyMode: 'multi' }, { userId, explicitTenantId: tenantId })).rejects.toThrow()
  })
  it('multi avec membership → renvoie le tenant', async () => {
    await ensureMembership(ctx.db, userId, tenantId)
    const r = await resolveTenantId(ctx.db, { tenancyMode: 'multi' }, { userId, explicitTenantId: tenantId })
    expect(r).toBe(tenantId)
  })
  it('single → tenant par défaut (sans exiger de membership)', async () => {
    const r = await resolveTenantId(ctx.db, { tenancyMode: 'single' }, {})
    expect(r).toBe(tenantId)
  })
})
