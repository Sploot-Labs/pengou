import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { startTestDb, runMigrations, schema, tenantScope, createQuiz } from '@splootlabs/db'
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

// Un payload valide par type, couvrant les 4 types du registre @splootlabs/quiz.
const validPayloadByType = {
  mcq: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
  truefalse: { correct: true },
  text: { answers: ['x'] },
  slider: { min: 0, max: 100, correct: 42 },
} as const

describe('e2e éditeur : inscription → quiz → 4 types de questions → reorder → isolation', () => {
  it('parcours complet, scopé par tenant', async () => {
    const app = await buildApp()

    // 1. Sign-up utilisateur A → cookie, puis création d'un quiz.
    const cookieA = await signUp(app, 'editor-e2e-a@example.com')
    const createQuizRes = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz e2e complet' },
      headers: { 'content-type': 'application/json', cookie: cookieA },
    })
    expect(createQuizRes.statusCode).toBe(201)
    const quiz = createQuizRes.json() as { id: string }
    const quizId = quiz.id

    // 2. Une question de chacun des 4 types, dans un ordre connu.
    const types = ['mcq', 'truefalse', 'text', 'slider'] as const
    const createdIds: string[] = []
    for (const type of types) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quizId}/questions`,
        payload: {
          type,
          prompt: `Question ${type}`,
          timeLimit: 20,
          payload: validPayloadByType[type],
        },
        headers: { 'content-type': 'application/json', cookie: cookieA },
      })
      expect(res.statusCode).toBe(201)
      const created = res.json() as { id: string; quizId: string; type: string }
      expect(created.quizId).toBe(quizId)
      expect(created.type).toBe(type)
      createdIds.push(created.id)
    }
    expect(createdIds).toHaveLength(4)

    // 3. GET /questions → les 4, dans l'ordre de création.
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/quizzes/${quizId}/questions`,
      headers: { cookie: cookieA },
    })
    expect(listRes.statusCode).toBe(200)
    const listBody = listRes.json() as Array<{ id: string }>
    expect(listBody.map((q) => q.id)).toEqual(createdIds)

    // 4. PUT /order avec la liste inversée → 200, puis GET reflète l'ordre inversé.
    const reversedIds = [...createdIds].reverse()
    const orderRes = await app.inject({
      method: 'PUT',
      url: `/api/quizzes/${quizId}/questions/order`,
      payload: { orderedIds: reversedIds },
      headers: { 'content-type': 'application/json', cookie: cookieA },
    })
    expect(orderRes.statusCode).toBe(200)

    const listAfterOrderRes = await app.inject({
      method: 'GET',
      url: `/api/quizzes/${quizId}/questions`,
      headers: { cookie: cookieA },
    })
    expect(listAfterOrderRes.statusCode).toBe(200)
    const listAfterOrderBody = listAfterOrderRes.json() as Array<{ id: string }>
    expect(listAfterOrderBody.map((q) => q.id)).toEqual(reversedIds)

    // 5. Isolation cross-tenant. Le mode 'single' résout toujours l'utilisateur courant
    // vers le tenant par défaut ; pour prouver l'isolation il faut un tenant réellement
    // distinct, seedé directement en base (même approche que dans routes-quizzes.test.ts) :
    // un 2e tenant, un owner qui lui appartient, et un quiz + question rattachés.
    const [foreignTenant] = await ctx.db.insert(schema.tenant).values({ name: 'Autre (e2e)' }).returning()
    const [foreignOwner] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'editor-e2e-foreign@x.fr', name: 'Étranger', emailVerified: false })
      .returning()
    const foreignQuiz = await createQuiz(tenantScope(ctx.db, foreignTenant.id), {
      ownerId: foreignOwner.id,
      title: 'Quiz étranger e2e',
    })

    // Sign-up d'un 2e utilisateur (utilisateur B). En mode single il partage le tenant par
    // défaut avec A, donc il ne voit ni le quiz de A (autre logique métier) ni, surtout,
    // le quiz du tenant étranger seedé ci-dessus — c'est ce dernier point qui prouve
    // l'isolation par tenant de bout en bout.
    const cookieB = await signUp(app, 'editor-e2e-b@example.com')

    const listForB = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: cookieB } })
    expect(listForB.statusCode).toBe(200)
    const listForBBody = listForB.json() as Array<{ id: string }>
    expect(listForBBody.some((q) => q.id === foreignQuiz.id)).toBe(false)

    // Utilisateur A (du tenant par défaut) tente d'accéder aux questions du quiz étranger → 404.
    const foreignQuestionsRes = await app.inject({
      method: 'GET',
      url: `/api/quizzes/${foreignQuiz.id}/questions`,
      headers: { cookie: cookieA },
    })
    expect(foreignQuestionsRes.statusCode).toBe(404)

    // Le quiz étranger est aussi absent de la liste de A.
    const listForA = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: cookieA } })
    expect(listForA.statusCode).toBe(200)
    const listForABody = listForA.json() as Array<{ id: string }>
    expect(listForABody.some((q) => q.id === foreignQuiz.id)).toBe(false)

    await app.close()
  })
})
