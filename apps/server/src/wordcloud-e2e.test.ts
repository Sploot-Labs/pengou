import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, MemorySessionStore, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'

// e2e du nuage de mots : diffusion cadencée vers l'hôte et le grand écran seulement, retrait par
// l'hôte (persisté en base), rejeu à la reconnexion de l'écran, persistance des réponses à la
// révélation, et non-régression de la question suivante. Mêmes utilitaires que `game-e2e.test.ts`.

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
    payload: { email, password: 'motdepasse-123456', name: 'Hôte nuage' },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const rawCookies = res.headers['set-cookie']
  expect(rawCookies).toBeDefined()
  return Array.isArray(rawCookies)
    ? rawCookies.map((c) => c.split(';')[0]).join('; ')
    : String(rawCookies).split(';')[0]
}

type BuiltApp = { app: FastifyInstance; url: string }

async function buildApp(): Promise<BuiltApp> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
  const io = attachRealtime(app, config)

  const store = new MemorySessionStore()
  const engine = createEngine({
    store,
    now: () => Date.now(),
    genPin: generatePin,
    genId: () => crypto.randomUUID(),
  })
  await registerGameGateway(io, { engine, systemDb: ctx.db, appDb: ctx.appDb, auth, config, store })

  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error("pas d'adresse")
  return { app, url: `http://127.0.0.1:${address.port}` }
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

/** Enregistre tous les événements `event` reçus par `client`, dans l'ordre. `until` résout au
 * premier payload (déjà reçu ou à venir) qui satisfait le prédicat. */
function record<T = unknown>(
  client: ClientSocket,
  event: string,
): {
  received: T[]
  until: (predicate: (payload: T) => boolean, timeoutMs?: number) => Promise<T>
} {
  const received: T[] = []
  const matchers: Array<{ predicate: (payload: T) => boolean; resolve: (v: T) => void }> = []
  client.on(event, (payload: T) => {
    received.push(payload)
    for (const m of [...matchers]) {
      if (m.predicate(payload)) {
        matchers.splice(matchers.indexOf(m), 1)
        m.resolve(payload)
      }
    }
  })
  return {
    received,
    until(predicate, timeoutMs = 5000) {
      const found = received.find(predicate)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} attendu non reçu`)), timeoutMs)
        matchers.push({
          predicate,
          resolve: (v) => {
            clearTimeout(timer)
            resolve(v)
          },
        })
      })
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type WordcloudView = {
  questionId: string
  words: Array<{ key: string; text: string; count: number }>
  participants: number
  totalWords: number
  truncated: boolean
}

describe('e2e : nuage de mots en direct', () => {
  it('diffusion cadencée aux seuls hôte et écran, retrait persisté, rejeu, persistance, question suivante inchangée', async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'nuage-host@example.com')
      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz nuage' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }

      // Chrono long sur le nuage : aucune révélation par expiration pendant le test.
      const q1Res = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: { type: 'wordcloud', prompt: 'Un mot pour la journée ?', timeLimit: 120, readingTime: 0, payload: {} },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(q1Res.statusCode).toBe(201)
      const q1 = q1Res.json() as { id: string }

      const q2Res = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: {
          type: 'mcq',
          prompt: 'Capitale de la France ?',
          timeLimit: 60,
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
      expect(q2Res.statusCode).toBe(201)

      // ---- Hôte, grand écran, deux joueurs. ----
      const host = await connectClient(url, { cookie })
      clients.push(host)
      const created = await ack<{ sessionId: string; pin: string; error?: string }>(host, 'host:create', {
        quizId: quiz.id,
      })
      expect(created.error).toBeUndefined()
      const { sessionId, pin } = created

      const tokenAck = await ack<{ displayToken: string }>(host, 'host:createScreenToken', {})
      const screen = await connectClient(url)
      clients.push(screen)
      const screenJoin = await ack<{ ok?: boolean; error?: string }>(screen, 'screen:join', {
        displayToken: tokenAck.displayToken,
      })
      expect(screenJoin.ok).toBe(true)

      const playerA = await connectClient(url)
      const playerB = await connectClient(url)
      clients.push(playerA, playerB)
      for (const [p, nickname] of [
        [playerA, 'Alice'],
        [playerB, 'Bob'],
      ] as const) {
        const joined = await ack<{ playerId?: string; error?: string }>(p, 'player:join', { pin, nickname })
        expect(joined.error).toBeUndefined()
      }

      const screenUpdates = record<WordcloudView>(screen, 'wordcloud:update')
      const hostUpdates = record<WordcloudView>(host, 'wordcloud:update')
      const playerAUpdates = record<WordcloudView>(playerA, 'wordcloud:update')
      const playerBUpdates = record<WordcloudView>(playerB, 'wordcloud:update')
      const screenProgress = record<{ answered: number; total: number }>(screen, 'screen:progress')
      const screenReveals = record<unknown>(screen, 'question:reveal')
      const screenShows = record<{ type?: string }>(screen, 'question:show')

      const startAck = await ack<{ error?: string }>(host, 'host:start', {})
      expect(startAck.error).toBeUndefined()
      await screenShows.until(() => true)

      // ---- Trois envois rapides du joueur A : au plus deux diffusions, la dernière complète. ----
      const sent = await Promise.all(
        ['café', 'Soleil', 'Plage'].map((word) =>
          ack<{ accepted?: boolean; words?: string[] }>(playerA, 'player:answer', { answer: { word } }),
        ),
      )
      expect(sent.map((s) => s.accepted)).toEqual([true, true, true])
      expect(sent.map((s) => s.words?.length).sort()).toEqual([1, 2, 3])

      await screenUpdates.until((v) => v.totalWords === 3, 3000)
      // Laisse passer largement toute émission différée encore en attente.
      await sleep(800)
      expect(screenUpdates.received.length).toBeGreaterThanOrEqual(1)
      expect(screenUpdates.received.length).toBeLessThanOrEqual(2)
      const lastAfterA = screenUpdates.received[screenUpdates.received.length - 1]
      expect(lastAfterA.questionId).toBe(q1.id)
      expect(lastAfterA.words.map((w) => w.key).sort()).toEqual(['cafe', 'plage', 'soleil'])
      expect(hostUpdates.received.length).toBeGreaterThanOrEqual(1)

      // ---- Joueur B : un mot. Pas d'auto-révélation pour un nuage. ----
      const bSent = await ack<{ accepted?: boolean; words?: string[] }>(playerB, 'player:answer', {
        answer: { word: 'CAFE' },
      })
      expect(bSent).toEqual({ accepted: true, words: ['CAFE'] })
      const withB = await screenUpdates.until((v) => v.totalWords === 4, 3000)
      expect(withB.words.find((w) => w.key === 'cafe')?.count).toBe(2)
      expect(withB.participants).toBe(2)
      await sleep(600)
      expect(screenReveals.received).toHaveLength(0)

      // `screen:progress` : une fois par joueur (premier mot seulement).
      expect(screenProgress.received).toHaveLength(2)
      expect(screenProgress.received[1]).toMatchObject({ answered: 2 })

      // ---- Retrait par l'hôte : diffusion immédiate sans « cafe », persistance en base. ----
      const forbidden = await ack<{ ok?: boolean; error?: string }>(playerA, 'host:wordcloudRemove', { word: 'Soleil' })
      expect(forbidden.error).toBeTruthy()
      const blank = await ack<{ ok?: boolean; error?: string }>(host, 'host:wordcloudRemove', { word: '   ' })
      expect(blank.error).toBeTruthy()
      const notString = await ack<{ ok?: boolean; error?: string }>(host, 'host:wordcloudRemove', { word: 42 })
      expect(notString.error).toBeTruthy()

      const tooLong = await ack<{ ok?: boolean; error?: string }>(host, 'host:wordcloudRemove', {
        word: 'x'.repeat(26),
      })
      expect(tooLong.error).toBeTruthy()
      const emptyKey = await ack<{ ok?: boolean; error?: string }>(host, 'host:wordcloudRemove', { word: '́' })
      expect(emptyKey.error).toBeTruthy()

      const countBeforeRemove = screenUpdates.received.length
      const removed = await ack<{ ok?: boolean; error?: string }>(host, 'host:wordcloudRemove', { word: 'CAFE' })
      expect(removed).toEqual({ ok: true })
      const afterRemove = await screenUpdates.until(
        (v) => screenUpdates.received.indexOf(v) >= countBeforeRemove && !v.words.some((w) => w.key === 'cafe'),
        1000,
      )
      expect(afterRemove.words.map((w) => w.key).sort()).toEqual(['plage', 'soleil'])

      const [dbSession] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
      expect(dbSession.wordcloudRemoved).toEqual({ [q1.id]: ['cafe'] })

      // ---- Grand écran qui se reconnecte en pleine question : rejeu du nuage à ce socket. ----
      const screen2 = await connectClient(url)
      clients.push(screen2)
      const screen2Updates = record<WordcloudView>(screen2, 'wordcloud:update')
      const reconnected = await ack<{ ok?: boolean; error?: string }>(screen2, 'screen:reconnect', {
        sessionId,
        displayToken: tokenAck.displayToken,
      })
      expect(reconnected.ok).toBe(true)
      const replayed = await screen2Updates.until(() => true, 2000)
      expect(replayed.questionId).toBe(q1.id)
      expect(replayed.words.map((w) => w.key).sort()).toEqual(['plage', 'soleil'])

      // ---- Révélation : persistance des réponses sans point. ----
      const updatesBeforeReveal = screenUpdates.received.length
      const revealAck = await ack<{ ok?: boolean; error?: string }>(host, 'host:reveal', {})
      expect(revealAck.ok).toBe(true)
      await screenReveals.until(() => true)
      // Le nuage final part juste avant `question:reveal`.
      expect(screenUpdates.received.length).toBe(updatesBeforeReveal + 1)
      expect(screenUpdates.received[updatesBeforeReveal].words.map((w) => w.key).sort()).toEqual(['plage', 'soleil'])

      const q1Rows = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.questionId, q1.id))
      expect(q1Rows).toHaveLength(2)
      const byWords = q1Rows.map((r) => (r.answer as { words: string[] }).words).sort((a, b) => b.length - a.length)
      expect(byWords).toEqual([['café', 'Soleil', 'Plage'], ['CAFE']])
      for (const row of q1Rows) {
        expect(row.isCorrect).toBe(false)
        expect(row.points).toBe(0)
      }

      // Aucun téléphone n'a reçu le nuage.
      expect(playerAUpdates.received).toHaveLength(0)
      expect(playerBUpdates.received).toHaveLength(0)

      // ---- Question mcq suivante : auto-révélation quand les deux ont répondu, pas de nuage. ----
      const updatesBeforeMcq = screenUpdates.received.length
      const revealsBeforeMcq = screenReveals.received.length
      const nextAck = await ack<{ phase?: string; error?: string }>(host, 'host:next', {})
      expect(nextAck.phase).toBe('question')
      for (const p of [playerA, playerB]) {
        const answered = await ack<{ accepted?: boolean }>(p, 'player:answer', { answer: { optionIndex: 0 } })
        expect(answered.accepted).toBe(true)
      }
      const mcqReveal = await screenReveals.until((v) => screenReveals.received.indexOf(v) >= revealsBeforeMcq, 3000)
      expect(JSON.stringify(mcqReveal)).toContain('Paris')
      expect(screenUpdates.received.length).toBe(updatesBeforeMcq)
      expect(playerAUpdates.received).toHaveLength(0)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)
})
