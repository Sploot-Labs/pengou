import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'
import {
  ensureDefaultTenant, resolveTenantId, ensureMembership,
  getMembershipRole, scopeForUser, firstMembershipRole,
} from './tenant.js'
import * as schema from './schema.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('ensureDefaultTenant', () => {
  it('reste idempotent sous concurrence (course)', async () => {
    const results = await Promise.all([
      ensureDefaultTenant(ctx.db),
      ensureDefaultTenant(ctx.db),
      ensureDefaultTenant(ctx.db),
    ])
    expect(new Set(results).size).toBe(1) // un seul id, aucune erreur, pas de doublon
  })

  it('est idempotent : deux appels renvoient le même id', async () => {
    const a = await ensureDefaultTenant(ctx.db)
    const b = await ensureDefaultTenant(ctx.db)
    expect(a).toBe(b)
  })
})

describe('resolveTenantId', () => {
  it('mode single : renvoie le tenant par défaut', async () => {
    const def = await ensureDefaultTenant(ctx.db)
    const resolved = await resolveTenantId(ctx.db, { tenancyMode: 'single' })
    expect(resolved).toBe(def)
  })

  it('mode multi : exige un tenant explicite, sinon lève', async () => {
    await expect(resolveTenantId(ctx.db, { tenancyMode: 'multi' })).rejects.toThrow()
    await expect(resolveTenantId(ctx.db, { tenancyMode: 'multi' }, { explicitTenantId: 'some-uuid' })).rejects.toThrow()
  })
  // Note (Plan 3, Task 5) : resolveTenantId en mode multi valide désormais l'appartenance
  // (membership) de l'utilisateur au tenant. Voir tenant-membership.test.ts pour le cas
  // « userId + membership existante → renvoie le tenant ».
})

describe('RBAC — rôle et scope role-aware (Slice 1)', () => {
  it('getMembershipRole renvoie le rôle du membership, ou null si absent', async () => {
    const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-A' }).returning()
    const [u] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'r1@x.fr', name: 'R1', emailVerified: false }).returning()
    await ensureMembership(ctx.db, u.id, t.id, 'admin')
    expect(await getMembershipRole(ctx.db, u.id, t.id)).toBe('admin')
    const [u2] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'r2@x.fr', name: 'R2', emailVerified: false }).returning()
    expect(await getMembershipRole(ctx.db, u2.id, t.id)).toBeNull()
  })

  it('scopeForUser : owner/admin → ownerId undefined ; member → ownerId = userId', async () => {
    const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-B' }).returning()
    const [admin] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'adm@x.fr', name: 'Adm', emailVerified: false }).returning()
    const [member] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'mem@x.fr', name: 'Mem', emailVerified: false }).returning()
    await ensureMembership(ctx.db, admin.id, t.id, 'admin')
    await ensureMembership(ctx.db, member.id, t.id, 'member')

    const adminScope = await scopeForUser(ctx.db, t.id, admin.id)
    expect(adminScope.tenantId).toBe(t.id)
    expect(adminScope.ownerId).toBeUndefined()

    const memberScope = await scopeForUser(ctx.db, t.id, member.id)
    expect(memberScope.ownerId).toBe(member.id)
  })

  it('scopeForUser : sans membership → traité comme member (ownerId = userId)', async () => {
    const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-C' }).returning()
    const [u] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'nomem@x.fr', name: 'NoMem', emailVerified: false }).returning()
    const scope = await scopeForUser(ctx.db, t.id, u.id)
    expect(scope.ownerId).toBe(u.id)
  })

  it('firstMembershipRole : owner pour le 1er membre du tenant, member ensuite', async () => {
    const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-D' }).returning()
    const [u1] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'f1@x.fr', name: 'F1', emailVerified: false }).returning()
    expect(await firstMembershipRole(ctx.db, t.id)).toBe('owner')
    await ensureMembership(ctx.db, u1.id, t.id, 'owner')
    expect(await firstMembershipRole(ctx.db, t.id)).toBe('member')
  })
})
