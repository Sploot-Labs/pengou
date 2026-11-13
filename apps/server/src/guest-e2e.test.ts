import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { runMigrations, startTestDb } from '@splootlabs/db'
import { createAuth, type Auth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'

// Un hôte invité (partie de démonstration) n'a accès, en REST, qu'à la lecture de ses espaces et de
// ses quiz : tout le reste de l'éditeur lui répond 403 GUEST_NOT_ALLOWED.

let ctx: Awaited<ReturnType<typeof startTestDb>>
let app: FastifyInstance
let auth: Auth

type WorkspaceList = { workspaces: Array<{ tenantId: string }> }

const cookieOf = (setCookie: string[]) => setCookie.map((c) => c.split(';')[0]).join('; ')

async function guestHeaders(): Promise<Record<string, string>> {
  const guest = await auth.api.signInAnonymous({ headers: new Headers(), returnHeaders: true })
  const cookie = cookieOf(guest.headers.getSetCookie())
  const workspaces = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })
  const [first] = (workspaces.json() as WorkspaceList).workspaces
  return { cookie, 'x-tenant-id': first?.tenantId ?? '', 'content-type': 'application/json' }
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi' })
  auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
  })
  app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
}, 120_000)

afterAll(async () => {
  await app?.close()
  await ctx?.stop()
})

describe('hôte invité et routes protégées', () => {
  it.each([
    ['POST', '/api/quizzes'],
    ['POST', '/api/quizzes/example'],
    ['GET', '/api/library/meta'],
    ['POST', '/api/library/draw'],
    ['POST', '/api/workspaces'],
    ['GET', '/api/sessions'],
    ['POST', '/api/media'],
  ] as const)('refuse %s %s à un invité', async (method, url) => {
    const headers = await guestHeaders()
    const res = await app.inject({ method, url, headers, ...(method === 'POST' ? { payload: { title: 'Quiz' } } : {}) })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('GUEST_NOT_ALLOWED')
  })

  it("laisse l'invité lire ses espaces et ses quiz", async () => {
    const headers = await guestHeaders()
    const workspaces = await app.inject({ method: 'GET', url: '/api/workspaces', headers })
    expect(workspaces.statusCode).toBe(200)
    expect((workspaces.json() as WorkspaceList).workspaces).toHaveLength(1)
    const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers })
    expect(quizzes.statusCode).toBe(200)
    expect(quizzes.json()).toEqual([])
  })

  it('ne change rien pour un compte ordinaire', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'ordinaire@example.org', password: 'motdepasse-123456', name: 'Hôte' },
      headers: { 'content-type': 'application/json' },
    })
    expect(signUp.statusCode).toBe(200)
    const cookie = cookieOf(([] as string[]).concat(signUp.headers['set-cookie'] ?? []))
    const workspaces = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })
    const [first] = (workspaces.json() as WorkspaceList).workspaces
    const res = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Mon quiz' },
      headers: { cookie, 'x-tenant-id': first.tenantId, 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(201)
  })
})
