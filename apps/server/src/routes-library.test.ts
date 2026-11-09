import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { CatalogSnapshot, SnapshotQuestion, SnapshotQuiz } from '@splootlabs/library'
import { startTestDb, runMigrations, syncLibrary } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

const srcA = { name: 'Source A', license: 'CC0' }
const srcB = { name: 'Source B', license: 'CC-BY-4.0', url: 'https://example.org/b' }

function q(id: string, over: Partial<SnapshotQuestion> = {}): SnapshotQuestion {
  return {
    id,
    type: 'truefalse',
    prompt: `Énoncé ${id} ?`,
    payload: { answer: true },
    theme: 'sciences',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    timeLimit: 20,
    readingTime: 6,
    source: srcA,
    origin: 'builtin',
    originFile: 'builtin/a.json',
    ...over,
  }
}

function quiz(id: string, questionIds: string[], over: Partial<SnapshotQuiz> = {}): SnapshotQuiz {
  return {
    id,
    title: `Quiz ${id}`,
    description: 'Une description',
    theme: 'sciences',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    questionIds,
    source: srcA,
    origin: 'builtin',
    originFile: 'builtin/a.json',
    ...over,
  }
}

const snapshot: CatalogSnapshot = {
  themes: [
    { id: 'sciences', label: 'Sciences', hidden: false, origin: 'builtin' },
    { id: 'histoire', label: 'Histoire', hidden: false, origin: 'builtin' },
    { id: 'secret', label: 'Secret', hidden: true, origin: 'instance' },
  ],
  questions: [
    q('q1'),
    q('q2'),
    q('q3', { difficulty: 'difficile' }),
    q('h1', { theme: 'histoire', source: srcB, language: 'en' }),
    q('s1', { theme: 'secret' }),
  ],
  quizzes: [quiz('z1', ['q3', 'q1', 'q2'])],
  rejectedFiles: [],
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  await syncLibrary(ctx.db, snapshot)
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

async function signUp(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Test' },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const raw = res.headers['set-cookie']
  return Array.isArray(raw) ? raw.map((c) => c.split(';')[0]).join('; ') : String(raw).split(';')[0]
}

async function buildApp(mode: 'single' | 'multi' = 'single'): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: mode })
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

const json = { 'content-type': 'application/json' }

describe('routes /api/library', () => {
  it('401 sans cookie sur chaque route', async () => {
    const app = await buildApp()
    const calls: Array<[string, string]> = [
      ['GET', '/api/library/meta'],
      ['GET', '/api/library/quizzes'],
      ['GET', '/api/library/quizzes/z1'],
      ['GET', '/api/library/questions'],
      ['POST', '/api/library/draw'],
      ['POST', '/api/library/quizzes/z1/duplicate'],
      ['POST', '/api/library/compose'],
    ]
    for (const [method, url] of calls) {
      const res = await app.inject({
        method: method as 'GET' | 'POST',
        url,
        payload: method === 'POST' ? {} : undefined,
        headers: json,
      })
      expect(res.statusCode, url).toBe(401)
    }
    await app.close()
  })

  it('meta liste les thèmes visibles, les niveaux, les publics et les langues', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-meta@example.com')
    const res = await app.inject({ method: 'GET', url: '/api/library/meta', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      themes: { id: string }[]
      difficulties: string[]
      audiences: string[]
      languages: string[]
    }
    expect(body.themes.map((t) => t.id).sort()).toEqual(['histoire', 'sciences'])
    expect(body.difficulties).toEqual(['facile', 'moyen', 'difficile'])
    expect(body.audiences).toEqual(['enfants', 'adultes', 'tous'])
    expect(body.languages).toEqual(['en', 'fr'])
    await app.close()
  })

  it('quizzes renvoie les quiz filtrés', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-quizzes@example.com')
    const all = await app.inject({ method: 'GET', url: '/api/library/quizzes', headers: { cookie } })
    expect((all.json() as { id: string; questionCount: number }[]).map((z) => [z.id, z.questionCount])).toEqual([
      ['z1', 3],
    ])
    const none = await app.inject({ method: 'GET', url: '/api/library/quizzes?theme=histoire', headers: { cookie } })
    expect(none.json()).toEqual([])
    const bad = await app.inject({ method: 'GET', url: '/api/library/quizzes?audience=martiens', headers: { cookie } })
    expect(bad.statusCode).toBe(400)
    await app.close()
  })

  it('questions : filtres, pagination, thème masqué exclu, enum inconnue en 400', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-questions@example.com')
    const get = (qs: string) => app.inject({ method: 'GET', url: `/api/library/questions${qs}`, headers: { cookie } })

    const all = (await get('')).json() as { items: { id: string }[]; total: number }
    expect(all.total).toBe(4)
    expect(all.items.map((i) => i.id)).not.toContain('s1')

    const page = (await get('?limit=2&offset=2')).json() as { items: unknown[]; total: number }
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(4)

    const hard = (await get('?difficulty=difficile')).json() as { items: { id: string }[] }
    expect(hard.items.map((i) => i.id)).toEqual(['q3'])

    const lang = (await get('?language=en&theme=histoire')).json() as { items: { id: string; source: unknown }[] }
    expect(lang.items.map((i) => i.id)).toEqual(['h1'])
    expect(lang.items[0].source).toEqual(srcB)

    const search = (await get('?search=enonce%20q2')).json() as { items: { id: string }[] }
    expect(search.items.map((i) => i.id)).toEqual(['q2'])

    expect((await get('?difficulty=extreme')).statusCode).toBe(400)
    expect((await get('?limit=abc')).statusCode).toBe(400)
    expect((await get('?offset=-1')).statusCode).toBe(400)
    const capped = (await get('?limit=1000')).json() as { items: unknown[] }
    expect(capped.items.length).toBeLessThanOrEqual(100)
    await app.close()
  })

  it('draw renvoie au plus le disponible et refuse un count invalide', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-draw@example.com')
    const post = (payload: unknown) =>
      app.inject({ method: 'POST', url: '/api/library/draw', payload: payload as object, headers: { ...json, cookie } })

    const res = await post({ filters: { theme: 'sciences' }, count: 10, excludeIds: ['q1'] })
    expect(res.statusCode).toBe(200)
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id).sort()
    expect(ids).toEqual(['q2', 'q3'])

    expect((await post({ filters: {}, count: 0 })).statusCode).toBe(400)
    expect((await post({ filters: {}, count: 51 })).statusCode).toBe(400)
    expect((await post({ filters: {}, count: 1.5 })).statusCode).toBe(400)
    expect((await post({ filters: { difficulty: 'extreme' }, count: 1 })).statusCode).toBe(400)
    expect(
      (await post({ filters: {}, count: 1, excludeIds: Array.from({ length: 201 }, (_, i) => `x${i}`) })).statusCode,
    ).toBe(400)
    await app.close()
  })

  it("l'aperçu d'un quiz renvoie ses questions dans l'ordre, 404 sur un id inconnu", async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-preview@example.com')
    const res = await app.inject({ method: 'GET', url: '/api/library/quizzes/z1', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { quiz: { id: string; source: unknown }; questions: { id: string; payload: unknown }[] }
    expect(body.quiz.id).toBe('z1')
    expect(body.quiz.source).toEqual(srcA)
    expect(body.questions.map((x) => x.id)).toEqual(['q3', 'q1', 'q2'])
    expect(body.questions[0].payload).toEqual({ answer: true })

    const missing = await app.inject({ method: 'GET', url: '/api/library/quizzes/inconnu', headers: { cookie } })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'Quiz introuvable dans la bibliothèque.' })
    await app.close()
  })

  it("duplicate copie le quiz du catalogue dans le tenant de l'utilisateur", async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-dup@example.com')
    const res = await app.inject({ method: 'POST', url: '/api/library/quizzes/z1/duplicate', headers: { cookie } })
    expect(res.statusCode).toBe(201)
    const created = res.json() as { id: string; title: string; description: string; source: unknown }
    expect(created.title).toBe('Quiz z1')
    expect(created.source).toEqual(srcA)

    const list = (await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })).json() as {
      id: string
    }[]
    expect(list.map((z) => z.id)).toContain(created.id)
    const qs = (
      await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}/questions`, headers: { cookie } })
    ).json() as { prompt: string; source: unknown }[]
    expect(qs.map((x) => x.prompt)).toEqual(['Énoncé q3 ?', 'Énoncé q1 ?', 'Énoncé q2 ?'])
    expect(qs[0].source).toEqual(srcA)
    await app.close()
  })

  it("duplicate d'un id inconnu renvoie 404 sans créer de quiz", async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-dup404@example.com')
    const res = await app.inject({ method: 'POST', url: '/api/library/quizzes/inconnu/duplicate', headers: { cookie } })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Quiz introuvable dans la bibliothèque.' })
    const list = (await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })).json() as unknown[]
    expect(list).toHaveLength(0)
    await app.close()
  })

  it('compose mêle deux sources : quiz sans source, questions avec la leur, ordre respecté', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-compose@example.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/library/compose',
      payload: { title: 'Mon mélange', questionIds: ['h1', 'q2'] },
      headers: { ...json, cookie },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json() as { id: string; title: string; source: unknown }
    expect(created.title).toBe('Mon mélange')
    expect(created.source).toBeNull()
    const qs = (
      await app.inject({ method: 'GET', url: `/api/quizzes/${created.id}/questions`, headers: { cookie } })
    ).json() as { prompt: string; source: unknown }[]
    expect(qs.map((x) => x.prompt)).toEqual(['Énoncé h1 ?', 'Énoncé q2 ?'])
    expect(qs.map((x) => x.source)).toEqual([srcB, srcA])
    await app.close()
  })

  it('compose : 404 sur id inconnu ou masqué sans créer de quiz, 400 sur entrées invalides', async () => {
    const app = await buildApp()
    const cookie = await signUp(app, 'lib-compose-bad@example.com')
    const post = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/library/compose',
        payload: payload as object,
        headers: { ...json, cookie },
      })

    for (const ids of [
      ['q1', 'inconnu'],
      ['q1', 's1'],
    ]) {
      const res = await post({ title: 'X', questionIds: ids })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'Question introuvable dans la bibliothèque.' })
    }
    const list = (await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })).json() as unknown[]
    expect(list).toHaveLength(0)

    expect((await post({ title: '  ', questionIds: ['q1'] })).statusCode).toBe(400)
    expect((await post({ title: 'x'.repeat(201), questionIds: ['q1'] })).statusCode).toBe(400)
    expect((await post({ title: 'X', questionIds: [] })).statusCode).toBe(400)
    expect((await post({ title: 'X', questionIds: ['q1', 'q1'] })).statusCode).toBe(400)
    expect((await post({ title: 'X', questionIds: Array.from({ length: 101 }, (_, i) => `x${i}`) })).statusCode).toBe(
      400,
    )
    await app.close()
  })

  it("un member d'un workspace qui compose voit et peut modifier son quiz", async () => {
    const app = await buildApp('multi')
    const ownerCookie = await signUp(app, 'lib-ws-owner@example.com')
    const ws = (
      await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: ownerCookie } })
    ).json() as { workspaces: { tenantId: string }[] }
    const tenantId = ws.workspaces[0].tenantId
    const inv = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenantId}/invitations`,
      payload: { email: 'lib-ws-member@example.com', role: 'member' },
      headers: { ...json, cookie: ownerCookie },
    })
    const token = (inv.json() as { invitation: { token: string } }).invitation.token
    const memberCookie = await signUp(app, 'lib-ws-member@example.com')
    expect(
      (await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: memberCookie } }))
        .statusCode,
    ).toBe(200)

    const headers = { ...json, cookie: memberCookie, 'x-tenant-id': tenantId }
    const res = await app.inject({
      method: 'POST',
      url: '/api/library/compose',
      payload: { title: 'Équipe', questionIds: ['q1'] },
      headers,
    })
    expect(res.statusCode).toBe(201)
    const created = res.json() as { id: string }
    const list = (await app.inject({ method: 'GET', url: '/api/quizzes', headers })).json() as { id: string }[]
    expect(list.map((z) => z.id)).toContain(created.id)
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quizzes/${created.id}`,
      payload: { title: 'Renommé' },
      headers,
    })
    expect(patch.statusCode).toBe(200)
    await app.close()
  })
})
