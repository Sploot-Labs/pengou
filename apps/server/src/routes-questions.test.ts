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
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { db: ctx.db, auth, config })
  return app
}

const validMcq = { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] }
const invalidMcq = { options: [{ label: 'A', correct: false }, { label: 'B', correct: false }] }

async function createQuizAndCookie(app: FastifyInstance, email: string): Promise<{ cookie: string; quizId: string }> {
  const cookie = await signUp(app, email)
  const create = await app.inject({
    method: 'POST',
    url: '/api/quizzes',
    payload: { title: 'Quiz questions' },
    headers: { 'content-type': 'application/json', cookie },
  })
  expect(create.statusCode).toBe(201)
  const quizId = (create.json() as { id: string }).id
  return { cookie, quizId }
}

describe('routes CRUD /api/quizzes/:quizId/questions (protégées, scopées)', () => {
  it('POST avec un mcq valide → 201', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q1@example.com')

    const res = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Combien font 2+2 ?', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { id: string; quizId: string; type: string }
    expect(body.quizId).toBe(quizId)
    expect(body.type).toBe('mcq')

    await app.close()
  })

  it('POST avec un mcq invalide (0 option correcte) → 400', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q2@example.com')

    const res = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Invalide', timeLimit: 20, payload: invalidMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(400)

    await app.close()
  })

  it('POST sous un quiz inexistant/étranger → 404', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'q3@example.com')

    const res = await app.inject({
      method: 'POST',
      url: '/api/quizzes/00000000-0000-0000-0000-000000000000/questions',
      payload: { type: 'mcq', prompt: 'X', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('GET /questions renvoie la liste ordonnée', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q4@example.com')

    const create1 = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Q1', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const create2 = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Q2', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const q1 = create1.json() as { id: string }
    const q2 = create2.json() as { id: string }

    const list = await app.inject({
      method: 'GET',
      url: `/api/quizzes/${quizId}/questions`,
      headers: { cookie },
    })
    expect(list.statusCode).toBe(200)
    const body = list.json() as Array<{ id: string }>
    expect(body.map((q) => q.id)).toEqual([q1.id, q2.id])

    await app.close()
  })

  it('GET /questions sous un quiz inexistant → 404', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'q5@example.com')

    const res = await app.inject({
      method: 'GET',
      url: '/api/quizzes/00000000-0000-0000-0000-000000000000/questions',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('PATCH modifie une question (prompt seul)', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q6@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Avant', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { prompt: 'Après' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(patch.statusCode).toBe(200)
    expect((patch.json() as { prompt: string }).prompt).toBe('Après')

    await app.close()
  })

  it('PATCH avec un payload invalide pour le type → 400', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q7@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Avant', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { type: 'mcq', payload: invalidMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(patch.statusCode).toBe(400)

    await app.close()
  })

  it('PATCH valide le payload contre le type STOCKÉ, pas contre un type déclaré par le client', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q7bis@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Question mcq', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string; type: string }
    expect(created.type).toBe('mcq')

    // Le client déclare (à tort) `type: 'truefalse'` et envoie un payload valide pour
    // `truefalse` mais invalide pour `mcq` (le type RÉEL, stocké en base). Le bypass
    // consisterait à valider contre le type déclaré par le client au lieu du type stocké —
    // ici on attend un 400 car le payload ne correspond pas au type mcq réellement stocké.
    const bypassAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { type: 'truefalse', payload: { correct: true } },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(bypassAttempt.statusCode).toBe(400)

    // Un payload valide pour le type stocké (mcq) doit toujours passer.
    const validUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { payload: { options: [{ label: 'X', correct: true }, { label: 'Y', correct: false }] } },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(validUpdate.statusCode).toBe(200)
    expect((validUpdate.json() as { type: string }).type).toBe('mcq')

    await app.close()
  })

  it('PATCH accepte readingTime (entier ≥ 0), mirror de timeLimit', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q7ter@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Avant', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string; readingTime: number }
    // Défaut serveur : 6 s quand non fourni à la création (phase lecture active par défaut).
    expect(created.readingTime).toBe(6)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { readingTime: 8 },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(patch.statusCode).toBe(200)
    expect((patch.json() as { readingTime: number }).readingTime).toBe(8)

    // 0 est une valeur légitime (« pas de temps de lecture »), pas un rejet.
    const patchZero = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { readingTime: 0 },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(patchZero.statusCode).toBe(200)
    expect((patchZero.json() as { readingTime: number }).readingTime).toBe(0)

    await app.close()
  })

  it('PATCH avec readingTime négatif ou non entier → 400', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q7quater@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Avant', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const negative = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { readingTime: -1 },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(negative.statusCode).toBe(400)

    const nonInteger = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      payload: { readingTime: 2.5 },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(nonInteger.statusCode).toBe(400)

    await app.close()
  })

  it('POST avec readingTime négatif → 400 ; readingTime valide est persisté', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q7quinquies@example.com')

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'X', timeLimit: 20, readingTime: -3, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(invalid.statusCode).toBe(400)

    const valid = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'X', timeLimit: 20, readingTime: 12, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(valid.statusCode).toBe(201)
    expect((valid.json() as { readingTime: number }).readingTime).toBe(12)

    await app.close()
  })

  it('PATCH sous un quiz inexistant/étranger → 404', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q8@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Q', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/00000000-0000-0000-0000-000000000000/questions/${created.id}`,
      payload: { prompt: 'x' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('DELETE supprime une question puis GET liste ne la contient plus', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q9@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'À supprimer', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/quizzes/${quizId}/questions/${created.id}`,
      headers: { cookie },
    })
    expect(del.statusCode).toBe(204)

    const list = await app.inject({ method: 'GET', url: `/api/quizzes/${quizId}/questions`, headers: { cookie } })
    const body = list.json() as Array<{ id: string }>
    expect(body.some((q) => q.id === created.id)).toBe(false)

    await app.close()
  })

  it('DELETE sous un quiz inexistant/étranger → 404', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q10@example.com')

    const create = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Q', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const created = create.json() as { id: string }

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/quizzes/00000000-0000-0000-0000-000000000000/questions/${created.id}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('PUT /order réordonne les questions', async () => {
    const app = await buildApp()
    const { cookie, quizId } = await createQuizAndCookie(app, 'q11@example.com')

    const create1 = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Q1', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const create2 = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'Q2', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json', cookie },
    })
    const q1 = create1.json() as { id: string }
    const q2 = create2.json() as { id: string }

    const order = await app.inject({
      method: 'PUT',
      url: `/api/quizzes/${quizId}/questions/order`,
      payload: { orderedIds: [q2.id, q1.id] },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(order.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: `/api/quizzes/${quizId}/questions`, headers: { cookie } })
    const body = list.json() as Array<{ id: string }>
    expect(body.map((q) => q.id)).toEqual([q2.id, q1.id])

    await app.close()
  })

  it('PUT /order sous un quiz inexistant/étranger → 404', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'q12@example.com')

    const res = await app.inject({
      method: 'PUT',
      url: '/api/quizzes/00000000-0000-0000-0000-000000000000/questions/order',
      payload: { orderedIds: [] },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('sans cookie → 401 sur toutes les routes', async () => {
    const app = await buildApp()
    const { quizId } = await createQuizAndCookie(app, 'q13@example.com')

    const post = await app.inject({
      method: 'POST',
      url: `/api/quizzes/${quizId}/questions`,
      payload: { type: 'mcq', prompt: 'X', timeLimit: 20, payload: validMcq },
      headers: { 'content-type': 'application/json' },
    })
    expect(post.statusCode).toBe(401)

    const get = await app.inject({ method: 'GET', url: `/api/quizzes/${quizId}/questions` })
    expect(get.statusCode).toBe(401)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quizId}/questions/00000000-0000-0000-0000-000000000000`,
      payload: { prompt: 'x' },
      headers: { 'content-type': 'application/json' },
    })
    expect(patch.statusCode).toBe(401)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/quizzes/${quizId}/questions/00000000-0000-0000-0000-000000000000`,
    })
    expect(del.statusCode).toBe(401)

    const order = await app.inject({
      method: 'PUT',
      url: `/api/quizzes/${quizId}/questions/order`,
      payload: { orderedIds: [] },
      headers: { 'content-type': 'application/json' },
    })
    expect(order.statusCode).toBe(401)

    await app.close()
  })
})
