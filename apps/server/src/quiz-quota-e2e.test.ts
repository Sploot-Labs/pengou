import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { CatalogSnapshot } from '@splootlabs/library'
import { startTestDb, runMigrations, syncLibrary, schema } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { MemoryMailer, type Mailer } from '@splootlabs/mail'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

const src = { name: 'Source A', license: 'CC0' }
const snapshot: CatalogSnapshot = {
  themes: [{ id: 'sciences', label: 'Sciences', hidden: false, origin: 'builtin' }],
  questions: [{
    id: 'q1', type: 'truefalse', prompt: 'Énoncé q1 ?', payload: { answer: true }, theme: 'sciences',
    difficulty: 'facile', language: 'fr', audience: 'tous', timeLimit: 20, readingTime: 6,
    source: src, origin: 'builtin', originFile: 'builtin/a.json',
  }],
  quizzes: [{
    id: 'z1', title: 'Quiz z1', description: 'Une description', theme: 'sciences', difficulty: 'facile', language: 'fr',
    audience: 'tous', questionIds: ['q1'], source: src, origin: 'builtin', originFile: 'builtin/a.json',
  }],
  rejectedFiles: [],
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  await syncLibrary(ctx.db, snapshot)
}, 120_000)
afterAll(async () => { await ctx?.stop() })

async function buildApp(mailer: Mailer | undefined, mode: 'single' | 'multi' = 'multi'): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: mode })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!', baseURL: 'http://localhost:3000', tenancyMode: config.tenancyMode,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config, mailer })
  return app
}

const json = { 'content-type': 'application/json' }

type User = { cookie: string; tenant: Record<string, string> }

async function signUp(app: FastifyInstance, email: string, withWorkspace = true): Promise<User> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Test' }, headers: json,
  })
  expect(res.statusCode).toBe(200)
  const raw = res.headers['set-cookie']
  const cookie = Array.isArray(raw) ? raw.map((c) => c.split(';')[0]).join('; ') : String(raw).split(';')[0]
  if (!withWorkspace) return { cookie, tenant: {} }
  // En mode multi, un quiz suppose un espace de travail, désigné par l'en-tête x-tenant-id.
  const ws = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Classe' }, headers: { ...json, cookie } })
  expect(ws.statusCode).toBe(201)
  const list = (await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })).json() as {
    workspaces: Array<{ tenantId: string }>
  }
  return { cookie, tenant: { 'x-tenant-id': list.workspaces[0].tenantId } }
}

const create = (app: FastifyInstance, u: User, title = 'Un quiz') =>
  app.inject({ method: 'POST', url: '/api/quizzes', payload: { title }, headers: { ...json, cookie: u.cookie, ...u.tenant } })
const duplicate = (app: FastifyInstance, u: User) =>
  app.inject({ method: 'POST', url: '/api/library/quizzes/z1/duplicate', headers: { cookie: u.cookie, ...u.tenant } })
const compose = (app: FastifyInstance, u: User) =>
  app.inject({
    method: 'POST', url: '/api/library/compose', payload: { title: 'Mélange', questionIds: ['q1'] },
    headers: { ...json, cookie: u.cookie, ...u.tenant },
  })

const REFUSAL = { code: 'email_unverified_quiz_limit', error: "Confirmez votre adresse e-mail pour créer d'autres quiz." }

describe('e2e : un seul quiz actif sans adresse confirmée', () => {
  it('refuse le second quiz en création, duplication et composition', async () => {
    const app = await buildApp(new MemoryMailer())
    const u = await signUp(app, 'quota-a@example.com')
    expect((await create(app, u)).statusCode).toBe(201)
    for (const res of [await create(app, u, 'Autre'), await duplicate(app, u), await compose(app, u)]) {
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual(REFUSAL)
    }
    await app.close()
  })

  it('archiver libère la place, mais restaurer ensuite est refusé', async () => {
    const app = await buildApp(new MemoryMailer())
    const u = await signUp(app, 'quota-b@example.com')
    const first = (await create(app, u)).json() as { id: string }
    expect((await app.inject({ method: 'POST', url: `/api/quizzes/${first.id}/archive`, headers: { cookie: u.cookie, ...u.tenant } })).statusCode).toBe(200)
    expect((await create(app, u, 'Second')).statusCode).toBe(201)
    const restored = await app.inject({ method: 'POST', url: `/api/quizzes/${first.id}/restore`, headers: { cookie: u.cookie, ...u.tenant } })
    expect(restored.statusCode).toBe(403)
    expect(restored.json()).toEqual(REFUSAL)
    await app.close()
  })

  it("après confirmation de l'adresse, plus de limite", async () => {
    const app = await buildApp(new MemoryMailer())
    const u = await signUp(app, 'quota-c@example.com')
    expect((await create(app, u)).statusCode).toBe(201)
    expect((await create(app, u, 'Autre')).statusCode).toBe(403)
    await ctx.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, 'quota-c@example.com'))
    expect((await create(app, u, 'Autre')).statusCode).toBe(201)
    await app.close()
  })

  it('aucune limite en mode single', async () => {
    const app = await buildApp(new MemoryMailer(), 'single')
    const u = await signUp(app, 'quota-d@example.com', false)
    expect((await create(app, u)).statusCode).toBe(201)
    expect((await create(app, u, 'Autre')).statusCode).toBe(201)
    await app.close()
  })

  it('aucune limite sans envoi actif (pas de mailer, ou mailer de repli)', async () => {
    for (const [i, mailer] of [undefined, new MemoryMailer({ enabled: false })].entries()) {
      const app = await buildApp(mailer)
      const u = await signUp(app, `quota-e${i}@example.com`)
      expect((await create(app, u)).statusCode).toBe(201)
      expect((await create(app, u, 'Autre')).statusCode).toBe(201)
      await app.close()
    }
  })
})
