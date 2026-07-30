import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'
import { withTenantTx, deriveAppUrl } from './index.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('RLS infra', () => {
  it('deriveAppUrl substitue user/password en gardant host/port/db', () => {
    const out = deriveAppUrl('postgres://owner:pw@db.host:5433/kahoot', { user: 'app_role', password: 's3cret' })
    expect(out).toBe('postgres://app_role:s3cret@db.host:5433/kahoot')
  })

  it('withTenantTx pose app.tenant_id (SET LOCAL) dans la transaction', async () => {
    const seen = await withTenantTx(ctx.db, { tenantId: '11111111-1111-1111-1111-111111111111' }, async (scope) => {
      const rows = await scope.db.execute(sql`select current_setting('app.tenant_id', true) as t`)
      return (rows as unknown as Array<{ t: string }>)[0].t
    })
    expect(seen).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('withTenantTx : le GUC ne fuit pas hors de la transaction', async () => {
    await withTenantTx(ctx.db, { tenantId: '22222222-2222-2222-2222-222222222222' }, async () => {})
    const rows = await ctx.db.execute(sql`select current_setting('app.tenant_id', true) as t`)
    expect((rows as unknown as Array<{ t: string | null }>)[0].t).toBeFalsy() // null/'' hors transaction
  })
})
