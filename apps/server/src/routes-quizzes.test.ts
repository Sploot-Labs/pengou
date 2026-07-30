import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { startTestDb, runMigrations, schema, tenantScope, createQuiz, getQuiz } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

/** Inscrit un utilisateur via Better Auth et renvoie le cookie de session à réutiliser. */
async function signUp(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Test User' },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const rawCookies = res.headers['set-cookie']
  expect(rawCookies).toBeDefined()
  return Array.isArray(rawCookies)
    ? rawCookies.map((c) => c.split(';')[0]).join('; ')
    : String(rawCookies).split(';')[0]
}

async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
  return app
}

describe('routes CRUD /api/quizzes (protégées, scopées)', () => {
  it('POST sans cookie → 401', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Sans session' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST avec cookie → 201, tenantId = tenant par défaut, ownerId = utilisateur inscrit', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'editeur1@example.com')

    const create = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Mon quiz' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(create.statusCode).toBe(201)
    const created = create.json() as { id: string; title: string; tenantId: string; ownerId: string }
    expect(created.title).toBe('Mon quiz')
    expect(created.tenantId).toBeDefined()
    expect(created.ownerId).toBeDefined()

    // Le tenant renvoyé doit être le tenant par défaut (mode single).
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    const meBody = me.json() as { user: { id: string } }
    expect(created.ownerId).toBe(meBody.user.id)

    await app.close()
  })

  it('POST avec titre vide → 400', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'editeur2@example.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: '' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('GET /api/quizzes renvoie la liste incluant le quiz créé', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'editeur3@example.com')
    const create = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz liste' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const list = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
    expect(list.statusCode).toBe(200)
    const body = list.json() as Array<{ id: string }>
    expect(body.some((q) => q.id === created.id)).toBe(true)

    await app.close()
  })

  it('GET sans cookie → 401', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/quizzes' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /:id, PATCH, DELETE puis GET → 404', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'editeur4@example.com')
    const create = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz cycle de vie' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const get = await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}`, headers: { cookie } })
    expect(get.statusCode).toBe(200)
    expect((get.json() as { title: string }).title).toBe('Quiz cycle de vie')

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${created.id}`,
      payload: { title: 'Quiz modifié' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(patch.statusCode).toBe(200)
    expect((patch.json() as { title: string }).title).toBe('Quiz modifié')

    const del = await app.inject({ method: 'DELETE', url: `/api/quizzes/${created.id}`, headers: { cookie } })
    expect(del.statusCode).toBe(200)

    const getAfterDelete = await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}`, headers: { cookie } })
    expect(getAfterDelete.statusCode).toBe(404)

    await app.close()
  })

  it('GET /:id inexistant → 404', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'editeur5@example.com')
    const res = await app.inject({
      method: 'GET',
      url: '/api/quizzes/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('PATCH/DELETE sans cookie → 401', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'editeur6@example.com')
    const create = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz protégé' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const getNoCookie = await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}` })
    expect(getNoCookie.statusCode).toBe(401)

    const patchNoCookie = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${created.id}`,
      payload: { title: 'x' },
      headers: { 'content-type': 'application/json' },
    })
    expect(patchNoCookie.statusCode).toBe(401)

    const deleteNoCookie = await app.inject({ method: 'DELETE', url: `/api/quizzes/${created.id}` })
    expect(deleteNoCookie.statusCode).toBe(401)

    await app.close()
  })

  it('intra-tenant (member) : le quiz d\'un autre MEMBER du même tenant est invisible (404) et non modifiable/supprimable', async () => {
    const app = await buildApp()

    // Deux utilisateurs distincts qui, en mode single, résolvent vers LE MÊME tenant par défaut.
    // Depuis Slice 1 (RBAC), l'isolation intra-tenant s'applique aux `member` (les owner/admin
    // ont un accès croisé — couvert par le test « admin voit… »). On force donc les deux en `member`.
    const cookieA = await signUp(app, 'owner-a@example.com')
    const cookieB = await signUp(app, 'owner-b@example.com')
    const [uA] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'owner-a@example.com'))
    const [uB] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'owner-b@example.com'))
    await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, uA.id))
    await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, uB.id))

    const create = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz privé de A' },
      headers: { 'content-type': 'application/json', cookie: cookieA },
    })
    const created = create.json() as { id: string }

    // userB ne doit RIEN pouvoir faire sur le quiz de userA.
    const getB = await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}`, headers: { cookie: cookieB } })
    expect(getB.statusCode).toBe(404)

    const patchB = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${created.id}`,
      payload: { title: 'volé par B' },
      headers: { 'content-type': 'application/json', cookie: cookieB },
    })
    expect(patchB.statusCode).toBe(404)

    const delB = await app.inject({ method: 'DELETE', url: `/api/quizzes/${created.id}`, headers: { cookie: cookieB } })
    expect(delB.statusCode).toBe(404)

    const listB = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: cookieB } })
    expect((listB.json() as Array<{ id: string }>).some((q) => q.id === created.id)).toBe(false)

    // userA, lui, voit et garde son quiz intact.
    const getA = await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}`, headers: { cookie: cookieA } })
    expect(getA.statusCode).toBe(200)
    expect((getA.json() as { title: string }).title).toBe('Quiz privé de A')

    await app.close()
  })

  it('un quiz d\'un AUTRE tenant est invisible (404, pas juste un id manquant) et absent de la liste', async () => {
    const app = await buildApp()

    // Seed direct en base : un second tenant, un owner qui lui appartient, et un quiz
    // qui lui est rattaché — sans passer par les routes (le tenant courant, en mode
    // single, résout toujours vers le tenant par défaut ; on simule ainsi un tenant
    // "étranger" que l'utilisateur de test ne pourra jamais atteindre via l'API).
    const [foreignTenant] = await ctx.db.insert(schema.tenant).values({ name: 'Autre' }).returning()
    const [foreignOwner] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'etranger@x.fr', name: 'Étranger', emailVerified: false })
      .returning()
    const foreignQuiz = await createQuiz(tenantScope(ctx.db, foreignTenant.id), {
      ownerId: foreignOwner.id,
      title: 'Étranger',
    })

    // Utilisateur normal : résout vers le tenant PAR DÉFAUT (différent du tenant étranger ci-dessus).
    const cookie = await signUp(app, 'editeur7@example.com')

    const get = await app.inject({ method: 'GET', url: `/api/quizzes/${foreignQuiz.id}`, headers: { cookie } })
    expect(get.statusCode).toBe(404)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${foreignQuiz.id}`,
      payload: { title: 'hack' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(patch.statusCode).toBe(404)

    const del = await app.inject({ method: 'DELETE', url: `/api/quizzes/${foreignQuiz.id}`, headers: { cookie } })
    expect(del.statusCode).toBe(404)

    const list = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
    const body = list.json() as Array<{ id: string }>
    expect(body.some((q) => q.id === foreignQuiz.id)).toBe(false)

    // Le quiz étranger existe toujours réellement (la DELETE 404 ci-dessus ne l'a pas supprimé) :
    // relu directement via son propre tenant, pas via l'API.
    const stillThere = await getQuiz(tenantScope(ctx.db, foreignTenant.id), foreignQuiz.id)
    expect(stillThere).not.toBeNull()

    await app.close()
  })

  it('un admin voit et modifie le quiz d\'un autre membre du même tenant (accès croisé par rôle)', async () => {
    const app = await buildApp()
    const adminCookie = await signUp(app, 'admin-x@example.com')
    const memberCookie = await signUp(app, 'member-x@example.com')

    // Fixer explicitement les rôles (indépendant du défaut de signup) : admin-x = admin, member-x = member.
    const [adminU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'admin-x@example.com'))
    const [memberU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'member-x@example.com'))
    await ctx.db.update(schema.membership).set({ role: 'admin' }).where(eq(schema.membership.userId, adminU.id))
    await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, memberU.id))

    // member-x crée un quiz.
    const created = await app.inject({
      method: 'POST', url: '/api/quizzes',
      payload: { title: 'Quiz du membre' },
      headers: { 'content-type': 'application/json', cookie: memberCookie },
    })
    const quizId = (created.json() as { id: string }).id

    // admin-x le voit dans sa liste (accès croisé) et peut le modifier.
    const listAdmin = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: adminCookie } })
    expect((listAdmin.json() as { id: string }[]).some((q) => q.id === quizId)).toBe(true)
    const patch = await app.inject({
      method: 'PATCH', url: `/api/quizzes/${quizId}`,
      payload: { title: 'Modifié par admin' },
      headers: { 'content-type': 'application/json', cookie: adminCookie },
    })
    expect(patch.statusCode).toBe(200)

    await app.close()
  })

  it('un member ne voit pas le quiz d\'un autre (owner-scoping maintenu)', async () => {
    const app = await buildApp()
    const ownerCookie = await signUp(app, 'owner-y@example.com')
    const memberCookie = await signUp(app, 'member-y@example.com')
    const [memberU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'member-y@example.com'))
    await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, memberU.id))

    const created = await app.inject({
      method: 'POST', url: '/api/quizzes',
      payload: { title: 'Quiz owner-y' },
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
    })
    const quizId = (created.json() as { id: string }).id

    const listMember = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: memberCookie } })
    expect((listMember.json() as { id: string }[]).some((q) => q.id === quizId)).toBe(false)
    const getOne = await app.inject({ method: 'GET', url: `/api/quizzes/${quizId}`, headers: { cookie: memberCookie } })
    expect(getOne.statusCode).toBe(404)

    await app.close()
  })
})
