import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations, schema, tenantScope, withTenantTx, createQuiz } from './index.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string, tenantB: string, ownerA: string, ownerB: string

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'B' }).returning()
  const [uA] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'a@x.fr', name: 'A', emailVerified: false }).returning()
  const [uB] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'b@x.fr', name: 'B', emailVerified: false }).returning()
  tenantA = tA.id; tenantB = tB.id; ownerA = uA.id; ownerB = uB.id
  // systemDb (propriétaire, bypass RLS) crée du contenu dans A et B.
  await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A' })
  await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B' })
}, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('RLS Postgres', () => {
  it('appDb SANS contexte tenant → erreur (fail-loud)', async () => {
    await expect(ctx.appDb.select().from(schema.quiz)).rejects.toThrow()
  })

  it('appDb dans le contexte A ne voit que les quiz de A', async () => {
    const rows = await withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) => s.db.select().from(schema.quiz))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((q) => q.tenantId === tenantA)).toBe(true)
    expect(rows.some((q) => q.title === 'Quiz B')).toBe(false)
  })

  it('appDb : INSERT avec un tenant_id ≠ contexte est rejeté (WITH CHECK)', async () => {
    await expect(
      withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) =>
        s.db.insert(schema.quiz).values({ tenantId: tenantB, ownerId: ownerA, title: 'X' }).returning()),
    ).rejects.toThrow()
  })

  it('systemDb voit tous les tenants (bypass propriétaire)', async () => {
    const rows = await ctx.db.select().from(schema.quiz)
    expect(rows.some((q) => q.tenantId === tenantA)).toBe(true)
    expect(rows.some((q) => q.tenantId === tenantB)).toBe(true)
  })
})
