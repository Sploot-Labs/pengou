import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from './index.js'
import {
  slugify,
  generateUniqueSlug,
  createWorkspace,
  listUserWorkspaces,
  getWorkspaceBySlug,
  countOwners,
  setMemberRole,
} from './workspace.js'
import { tenantScope } from './tenant.js'
import type { Db } from './client.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

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
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('slugify', () => {
  it('normalise en minuscules, tirets, sans bords', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp')
    expect(slugify('  Éléphant !! Bleu  ')).toBe('l-phant-bleu')
    expect(slugify('___a__b___')).toBe('a-b')
    expect(slugify('')).toBe('')
  })
})

describe('generateUniqueSlug', () => {
  it('renvoie la base libre, sinon désambiguïse -2, -3…', async () => {
    const uid = await makeUser('slug@pengou.app')
    const first = await generateUniqueSlug(ctx.db, 'Acme')
    expect(first).toBe('acme')
    await createWorkspace(ctx.db, { name: 'Acme', ownerId: uid })
    const second = await generateUniqueSlug(ctx.db, 'Acme')
    expect(second).toBe('acme-2')
  })
})

describe('createWorkspace', () => {
  it('crée le tenant + une membership owner et renvoie le tenant avec slug', async () => {
    const uid = await makeUser('owner@pengou.app')
    const ws = await createWorkspace(ctx.db, { name: 'Mon Espace', ownerId: uid })
    expect(ws.name).toBe('Mon Espace')
    expect(ws.slug).toBe('mon-espace')
    const [m] = await ctx.db
      .select()
      .from(schema.membership)
      .where(and(eq(schema.membership.userId, uid), eq(schema.membership.tenantId, ws.id)))
    expect(m.role).toBe('owner')
  })

  it('deux workspaces de même nom → slugs distincts', async () => {
    const u1 = await makeUser('dup1@pengou.app')
    const u2 = await makeUser('dup2@pengou.app')
    const a = await createWorkspace(ctx.db, { name: 'Doublon', ownerId: u1 })
    const b = await createWorkspace(ctx.db, { name: 'Doublon', ownerId: u2 })
    expect(a.slug).not.toBe(b.slug)
    expect(a.name).toBe(b.name)
  })
})

describe('createWorkspace, créations simultanées', () => {
  // Douze créations du même nom lisent toutes le même slug libre : onze butent sur l'unicité et
  // doivent retenter, pas échouer. L'erreur de Postgres arrive enveloppée par drizzle.
  it('donne un slug distinct à chacune, sans erreur', async () => {
    const owners = await Promise.all(Array.from({ length: 12 }, (_, i) => makeUser(`simultane-${i}@example.org`)))
    const created = await Promise.all(
      owners.map((ownerId) => createWorkspace(ctx.db, { name: 'Salle commune', ownerId })),
    )
    expect(new Set(created.map((w) => w.slug)).size).toBe(12)
  })
})

describe('listUserWorkspaces', () => {
  it('renvoie les workspaces de l’utilisateur avec son rôle', async () => {
    const uid = await makeUser('multi@pengou.app')
    const a = await createWorkspace(ctx.db, { name: 'WS Un', ownerId: uid })
    const b = await createWorkspace(ctx.db, { name: 'WS Deux', ownerId: uid })
    const list = await listUserWorkspaces(ctx.db, uid)
    const ids = list.map((w) => w.tenantId).sort()
    expect(ids).toEqual([a.id, b.id].sort())
    expect(list.every((w) => w.role === 'owner')).toBe(true)
    expect(list.find((w) => w.tenantId === a.id)?.slug).toBe('ws-un')
  })
})

describe('getWorkspaceBySlug', () => {
  it('résout par slug, null si absent', async () => {
    const uid = await makeUser('byslug@pengou.app')
    const ws = await createWorkspace(ctx.db, { name: 'Par Slug', ownerId: uid })
    expect((await getWorkspaceBySlug(ctx.db, 'par-slug'))?.id).toBe(ws.id)
    expect(await getWorkspaceBySlug(ctx.db, 'inexistant-xyz')).toBeNull()
  })
})

describe('countOwners', () => {
  it('sérialise deux rétrogradations concurrentes', async () => {
    const a = await makeUser('race-a@pengou.app')
    const b = await makeUser('race-b@pengou.app')
    const ws = await createWorkspace(ctx.db, { name: 'Course owners', ownerId: a })
    await ctx.db.insert(schema.membership).values({ userId: b, tenantId: ws.id, role: 'owner' })

    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let tx1Demoted!: () => void
    const demoted = new Promise<void>((r) => {
      tx1Demoted = r
    })

    const tx1 = ctx.db.transaction(async (tx) => {
      const scope = tenantScope(tx as unknown as Db, ws.id)
      expect(await countOwners(scope)).toBe(2)
      await setMemberRole(scope, a, 'admin')
      tx1Demoted()
      await gate
    })
    await demoted

    let tx2Done = false
    const tx2 = ctx.db.transaction(async (tx) => {
      const n = await countOwners(tenantScope(tx as unknown as Db, ws.id))
      tx2Done = true
      return n
    })
    await new Promise((r) => setTimeout(r, 100))
    const pendingAfterWait = !tx2Done
    release()
    expect(pendingAfterWait).toBe(true)
    await tx1
    expect(await tx2).toBe(1)
  })
})
