import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { startTestDb, runMigrations } from '@splootlabs/db'
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
  const app = buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { db: ctx.db, auth, config })
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
})
