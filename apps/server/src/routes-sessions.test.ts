import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  startTestDb, runMigrations, schema, tenantScope, createQuiz,
  createGameSession, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
} from '@splootlabs/db'
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

/** Seed direct en base d'une session terminée avec joueurs + réponses, pour le tenant PAR DÉFAUT
 * (mode single) — c'est le tenant que `signUp` résoudra toujours. */
async function seedFinishedSession(ownerId: string, tenantId: string, pin: string): Promise<{ sessionId: string; quizId: string }> {
  const scope = tenantScope(ctx.db, tenantId)
  const quiz = await createQuiz(scope, { ownerId, title: 'Quiz rapport' })
  const [question] = await ctx.db.insert(schema.question).values({
    quizId: quiz.id, tenantId, type: 'mcq', prompt: 'Question 1', timeLimit: 20, orderIndex: 0,
    payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
  }).returning()

  const session = await createGameSession(scope, { quizId: quiz.id, hostId: ownerId, pin })
  const sessionId = session!.id

  const alice = await addSessionPlayer(ctx.db, sessionId, { nickname: 'Alice', joinToken: 'tok-alice' })
  const bob = await addSessionPlayer(ctx.db, sessionId, { nickname: 'Bob', joinToken: 'tok-bob' })

  await recordAnswer(ctx.db, { sessionId, questionId: question.id, playerId: alice.id, answer: { choice: 0 }, timeMs: 3000, isCorrect: true, points: 900 })
  await recordAnswer(ctx.db, { sessionId, questionId: question.id, playerId: bob.id, answer: { choice: 1 }, timeMs: 5000, isCorrect: false, points: 0 })

  await setPlayerScore(ctx.db, alice.id, 900)
  await setPlayerScore(ctx.db, bob.id, 0)
  await setSessionStatus(ctx.db, sessionId, 'ended')

  return { sessionId, quizId: quiz.id }
}

describe('routes de rapport /api/sessions (protégées, scopées)', () => {
  it('GET /api/sessions sans cookie → 401', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /api/sessions/:id sans cookie → 401', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions/00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /api/sessions/:id/export.csv sans cookie → 401', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions/00000000-0000-0000-0000-000000000000/export.csv' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /api/sessions renvoie la liste (quizTitle, playerCount) et respecte ?limit=', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'hote1@example.com')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    const userId = (me.json() as { user: { id: string } }).user.id

    // Résout le tenant par défaut via une création de quiz par API (le tenant assigné
    // est celui que retourne createQuiz, garanti être le tenant par défaut en mode single).
    const created = await app.inject({
      method: 'POST', url: '/api/quizzes', payload: { title: 'x' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const tenantId = (created.json() as { tenantId: string }).tenantId

    const { sessionId } = await seedFinishedSession(userId, tenantId, '111111')
    // Une seconde session pour tester ?limit=1 (garde l'ordre : la plus récente d'abord).
    await seedFinishedSession(userId, tenantId, '222222')

    const list = await app.inject({ method: 'GET', url: '/api/sessions', headers: { cookie } })
    expect(list.statusCode).toBe(200)
    const rows = list.json() as Array<{ id: string; quizTitle: string; playerCount: number }>
    const seeded = rows.find((r) => r.id === sessionId)
    expect(seeded).toBeDefined()
    expect(seeded!.quizTitle).toBe('Quiz rapport')
    expect(seeded!.playerCount).toBe(2)

    const limited = await app.inject({ method: 'GET', url: '/api/sessions?limit=1', headers: { cookie } })
    expect((limited.json() as unknown[]).length).toBe(1)

    await app.close()
  })

  it('GET /api/sessions?status=ended ne renvoie que les parties terminées', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'hote-status@example.com')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    const userId = (me.json() as { user: { id: string } }).user.id

    const created = await app.inject({
      method: 'POST', url: '/api/quizzes', payload: { title: 'x' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const tenantId = (created.json() as { tenantId: string }).tenantId
    const scope = tenantScope(ctx.db, tenantId)

    await seedFinishedSession(userId, tenantId, '555555')
    // Une session encore en lobby (jamais démarrée) : ne doit pas ressortir avec ?status=ended.
    const quiz = await createQuiz(scope, { ownerId: userId, title: 'Quiz lobby' })
    await createGameSession(scope, { quizId: quiz.id, hostId: userId, pin: '666666' })

    const res = await app.inject({ method: 'GET', url: '/api/sessions?status=ended', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const rows = res.json() as { status: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.status === 'ended')).toBe(true)

    await app.close()
  })

  it('GET /api/sessions/:id renvoie les agrégats du rapport', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'hote2@example.com')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    const userId = (me.json() as { user: { id: string } }).user.id
    const created = await app.inject({
      method: 'POST', url: '/api/quizzes', payload: { title: 'x' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const tenantId = (created.json() as { tenantId: string }).tenantId

    const { sessionId } = await seedFinishedSession(userId, tenantId, '333333')

    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const report = res.json() as {
      session: { id: string; pin: string; quizTitle: string }
      players: Array<{ nickname: string; totalScore: number }>
      questions: Array<{ answerCount: number; correctCount: number }>
    }
    expect(report.session.id).toBe(sessionId)
    expect(report.session.pin).toBe('333333')
    expect(report.session.quizTitle).toBe('Quiz rapport')
    expect(report.players.map((p) => p.nickname)).toEqual(['Alice', 'Bob'])
    expect(report.players[0].totalScore).toBe(900)
    expect(report.questions[0].answerCount).toBe(2)
    expect(report.questions[0].correctCount).toBe(1)

    await app.close()
  })

  it('GET /api/sessions/:id inexistant → 404', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'hote3@example.com')
    const res = await app.inject({
      method: 'GET', url: '/api/sessions/00000000-0000-0000-0000-000000000000', headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('GET /api/sessions/:id/export.csv → 200, content-type CSV, BOM, contient pseudo + score', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'hote4@example.com')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    const userId = (me.json() as { user: { id: string } }).user.id
    const created = await app.inject({
      method: 'POST', url: '/api/quizzes', payload: { title: 'x' },
      headers: { 'content-type': 'application/json', cookie },
    })
    const tenantId = (created.json() as { tenantId: string }).tenantId

    const { sessionId } = await seedFinishedSession(userId, tenantId, '444444')

    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/export.csv`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="pingou-partie-444444\.csv"$/)
    const body = res.body
    expect(body.charCodeAt(0)).toBe(0xfeff) // BOM UTF-8
    expect(body).toContain('Alice')
    expect(body).toContain('900')

    await app.close()
  })

  it('session/rapport/csv d\'un AUTRE tenant → 404 sur les trois, pas de fuite', async () => {
    const app = await buildApp()

    // Tenant étranger + session seedée directement, hors du tenant par défaut résolu par signUp.
    const [foreignTenant] = await ctx.db.insert(schema.tenant).values({ name: 'Étranger' }).returning()
    const [foreignOwner] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'etranger-sess@x.fr', name: 'Étranger', emailVerified: false })
      .returning()
    const { sessionId: foreignSessionId } = await seedFinishedSession(foreignOwner.id, foreignTenant.id, '999999')

    const cookie = await signUp(app, 'hote5@example.com')

    const list = await app.inject({ method: 'GET', url: '/api/sessions', headers: { cookie } })
    const rows = list.json() as Array<{ id: string }>
    expect(rows.some((r) => r.id === foreignSessionId)).toBe(false)

    const detail = await app.inject({ method: 'GET', url: `/api/sessions/${foreignSessionId}`, headers: { cookie } })
    expect(detail.statusCode).toBe(404)

    const csv = await app.inject({ method: 'GET', url: `/api/sessions/${foreignSessionId}/export.csv`, headers: { cookie } })
    expect(csv.statusCode).toBe(404)

    await app.close()
  })
})
