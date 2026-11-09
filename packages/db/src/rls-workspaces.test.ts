import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema, withTenantTx, createWorkspace } from './index.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string, tenantB: string, ownerA: string, ownerB: string

async function makeUser(email: string): Promise<string> {
  const [u] = await ctx.db
    .insert(schema.user)
    .values({ id: crypto.randomUUID(), email, name: email, emailVerified: false })
    .returning()
  return u.id
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  ownerA = await makeUser('rlsA@pengou.app')
  ownerB = await makeUser('rlsB@pengou.app')
  const wsA = await createWorkspace(ctx.db, { name: 'RLS A', ownerId: ownerA })
  const wsB = await createWorkspace(ctx.db, { name: 'RLS B', ownerId: ownerB })
  tenantA = wsA.id
  tenantB = wsB.id
  // Une invitation dans chaque tenant (créée via systemDb, bypass RLS).
  await ctx.db.insert(schema.invitation).values({
    tenantId: tenantA,
    email: 'x@a.fr',
    role: 'member',
    token: 'tok-a',
    invitedBy: ownerA,
    expiresAt: new Date(Date.now() + 86400_000),
  })
  await ctx.db.insert(schema.invitation).values({
    tenantId: tenantB,
    email: 'x@b.fr',
    role: 'member',
    token: 'tok-b',
    invitedBy: ownerB,
    expiresAt: new Date(Date.now() + 86400_000),
  })
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('RLS tenant/membership/invitation (Slice 3)', () => {
  it('appDb SANS contexte → fail-loud sur membership et invitation', async () => {
    await expect(ctx.appDb.select().from(schema.membership)).rejects.toThrow()
    await expect(ctx.appDb.select().from(schema.invitation)).rejects.toThrow()
    await expect(ctx.appDb.select().from(schema.tenant)).rejects.toThrow()
  })

  it('contexte A : ne voit que la ligne tenant A', async () => {
    const rows = await withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) => s.db.select().from(schema.tenant))
    expect(rows.map((t) => t.id)).toEqual([tenantA])
  })

  it('contexte A : ne voit que les memberships de A', async () => {
    const rows = await withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) => s.db.select().from(schema.membership))
    expect(rows.length).toBe(1)
    expect(rows.every((m) => m.tenantId === tenantA)).toBe(true)
  })

  it('contexte A : ne voit que les invitations de A', async () => {
    const rows = await withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) => s.db.select().from(schema.invitation))
    expect(rows.map((i) => i.token)).toEqual(['tok-a'])
  })

  it('contexte A : INSERT membership avec tenant_id=B rejeté (WITH CHECK)', async () => {
    await expect(
      withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) =>
        s.db.insert(schema.membership).values({ userId: ownerA, tenantId: tenantB, role: 'member' }).returning(),
      ),
    ).rejects.toThrow()
  })

  it('systemDb voit les deux tenants (bypass)', async () => {
    const rows = await ctx.db.select().from(schema.tenant).where(eq(schema.tenant.id, tenantB))
    expect(rows.length).toBe(1)
  })
})
