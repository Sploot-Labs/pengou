import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'
import { PersistentSessionStore } from './persistent-store.js'

// e2e Task 6 (Plan 5) : preuve de bout en bout du balayage périodique des parties inactives —
// bascule DB (`abandonInactiveSessions`, Task 3) + nettoyage de l'état mémoire LOCAL de la
// passerelle (minuteur de lecture, correspondances, cache du store — Task 5). Réutilise les
// mêmes patrons de connexion/inscription/seeding que `game-e2e.test.ts`, avec un
// `PersistentSessionStore` (le balayage exige `last_activity_at`, posé par `saveEngineState`,
// et une éviction cache observable côté `store.getByPin`).

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

async function signUp(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Hôte sweep e2e' },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const rawCookies = res.headers['set-cookie']
  expect(rawCookies).toBeDefined()
  return Array.isArray(rawCookies)
    ? rawCookies.map((c) => c.split(';')[0]).join('; ')
    : String(rawCookies).split(';')[0]
}

function connectClient(url: string, extraHeaders?: Record<string, string>): Promise<ClientSocket> {
  const client = ioClient(url, { reconnection: false, extraHeaders })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000)
    client.once('connect', () => {
      clearTimeout(timeout)
      resolve(client)
    })
    client.once('connect_error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function ack<T = unknown>(client: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    client.emit(event, payload, (response: T) => resolve(response))
  })
}

describe('sweepAbandonedSessions — balayage périodique des parties inactives', () => {
  it('bascule une partie inactive en base et nettoie mémoire + cache du store', async () => {
    const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
    const app = await buildServer(config, { dbStatus: () => 'up' })
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: config.tenancyMode,
    })
    await registerAuth(app, auth)
    registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
    const io = attachRealtime(app, config)
    const store = new PersistentSessionStore(ctx.db)
    const engine = createEngine({ store, now: () => Date.now(), genPin: generatePin, genId: () => crypto.randomUUID() })
    const gateway = await registerGameGateway(io, { engine, db: ctx.db, auth, config, store })

    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error("pas d'adresse")
    const url = `http://127.0.0.1:${address.port}`

    const clients: ClientSocket[] = []
    try {
      // ---- 1. Hôte : inscription → cookie → quiz à 1 question via l'API éditeur. ----
      const cookie = await signUp(app, 'sweep-e2e-host@example.com')

      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz sweep e2e' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }

      const qRes = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: {
          type: 'mcq',
          prompt: 'Capitale de la France ?',
          timeLimit: 5,
          readingTime: 0,
          payload: {
            options: [
              { label: 'Paris', correct: true },
              { label: 'Lyon', correct: false },
            ],
          },
        },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(qRes.statusCode).toBe(201)

      // ---- 2. host:create puis host:start : la partie devient 'active' et persiste son état. ----
      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)

      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocket, 'host:create', { quizId: quiz.id },
      )
      expect(created.error).toBeUndefined()
      expect(created.pin).toMatch(/^\d{6}$/)
      const sessionId = created.sessionId!
      const pin = created.pin!

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // ---- 3. Rendre la partie « inactive » : `last_activity_at` bien avant le seuil de balayage. ----
      await ctx.db.update(schema.gameSession)
        .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
        .where(eq(schema.gameSession.id, sessionId))

      // ---- 4. Balayage : bascule DB + nettoyage mémoire local + éviction cache du store. ----
      await gateway.sweepAbandonedSessions()

      const [row] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
      expect(row.status).toBe('abandoned')
      expect(row.engineState).toBeNull()

      // Le PIN est libéré côté cache : `getByPin` ne retrouve plus rien (ni en cache, ni en base
      // — `engine_state` a été mis à `null` par `abandonInactiveSessions`).
      expect(await store.getByPin(pin)).toBeUndefined()
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)
})
