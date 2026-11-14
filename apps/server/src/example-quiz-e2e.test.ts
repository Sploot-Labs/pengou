import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { runMigrations, startTestDb } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { validateQuestionPayload, type QuestionType } from '@splootlabs/quiz'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { EXAMPLE_QUIZ } from './example-quiz.js'

describe("contenu du quiz d'exemple", () => {
  it('chaque question est valide pour son type, une par grand type', () => {
    for (const q of EXAMPLE_QUIZ.questions) {
      expect(() => validateQuestionPayload(q.type as QuestionType, q.payload), q.prompt).not.toThrow()
    }
    expect(EXAMPLE_QUIZ.questions.map((q) => q.type)).toEqual(['mcq', 'truefalse', 'slider', 'poll', 'wordcloud'])
  })

  it('vouvoie', () => {
    const texts = [EXAMPLE_QUIZ.title, EXAMPLE_QUIZ.description, ...EXAMPLE_QUIZ.questions.map((q) => q.prompt)]
    for (const text of texts) expect(text).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i)
  })
})

let ctx: Awaited<ReturnType<typeof startTestDb>>
let app: FastifyInstance

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
  const auth = createAuth(ctx.db, {
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

describe('POST /api/quizzes/example', () => {
  it('exige une session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/quizzes/example' })
    expect(res.statusCode).toBe(401)
  })

  it("crée un quiz d'exemple de cinq questions, modifiable par son auteur", async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'exemple@example.org', password: 'motdepasse-123456', name: 'Hôte' },
      headers: { 'content-type': 'application/json' },
    })
    expect(signUp.statusCode).toBe(200)
    const cookie = ([] as string[])
      .concat(signUp.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')

    const res = await app.inject({ method: 'POST', url: '/api/quizzes/example', headers: { cookie } })
    expect(res.statusCode).toBe(201)
    const quiz = res.json() as { id: string; title: string }
    expect(quiz.title).toBe('Mon premier quiz (exemple)')

    const questions = await app.inject({ method: 'GET', url: `/api/quizzes/${quiz.id}/questions`, headers: { cookie } })
    expect(questions.statusCode).toBe(200)
    expect((questions.json() as { prompt: string }[]).map((q) => q.prompt)).toEqual(
      EXAMPLE_QUIZ.questions.map((q) => q.prompt),
    )

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${quiz.id}`,
      payload: { title: 'Mon quiz à moi' },
      headers: { cookie, 'content-type': 'application/json' },
    })
    expect(renamed.statusCode).toBe(200)
  })

  it("crée le quiz d'exemple dans la langue de la requête", async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'ejemplo@example.org', password: 'motdepasse-123456', name: 'Anfitrión' },
      headers: { 'content-type': 'application/json' },
    })
    const cookie = ([] as string[])
      .concat(signUp.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')
    const res = await app.inject({
      method: 'POST',
      url: '/api/quizzes/example',
      headers: { cookie, 'accept-language': 'es-ES,es;q=0.9' },
    })
    expect(res.statusCode).toBe(201)
    expect((res.json() as { title: string }).title).toBe('Mi primer quiz (ejemplo)')
  })
})
