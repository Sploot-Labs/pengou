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

// e2e Task 6 (Plan 5) : preuve de bout en bout de la chaîne complète du moteur de jeu —
// lobby → question → reveal → scoreboard → podium — avec scoring serveur-autoritaire
// (bonus de rapidité), persistance en base (game_session/session_player/answer_record) et
// anti-triche sur le fil (aucune bonne réponse dans `question:show`). Réutilise les patterns
// de socket/inscription/seeding de quiz de `game-gateway.test.ts` / `routes-quizzes.test.ts`.

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
    payload: { email, password: 'motdepasse-123456', name: 'Hôte e2e' },
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
  registerEditor(app, { db: ctx.db, auth, config })
  const io = attachRealtime(app, config)

  const store = new MemorySessionStore()
  const engine = createEngine({
    store,
    now: () => Date.now(),
    genPin: generatePin,
    genId: () => crypto.randomUUID(),
  })
  await registerGameGateway(io, { engine, db: ctx.db, auth, config, store })

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

function waitFor<T = unknown>(client: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => client.once(event, (payload: T) => resolve(payload)))
}

/** Collecte tous les événements `event` reçus (au lieu de `.once`, qui rate un événement émis
 * avant l'enregistrement du listener) — `atLeast(n)` résout dès que le n-ième événement arrive.
 * Même utilitaire que `game-gateway.test.ts` (3 joueurs qui rejoignent coup sur coup). */
function collect<T = unknown>(client: ClientSocket, event: string): { atLeast: (n: number) => Promise<T> } {
  const received: T[] = []
  const waiters: Array<{ n: number; resolve: (v: T) => void }> = []
  client.on(event, (payload: T) => {
    received.push(payload)
    for (const w of [...waiters]) {
      if (received.length >= w.n) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(received[w.n - 1])
      }
    }
  })
  return {
    atLeast(n: number) {
      if (received.length >= n) return Promise.resolve(received[n - 1])
      return new Promise((resolve) => waiters.push({ n, resolve }))
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('e2e — partie complète (lobby → podium) : scoring serveur-autoritaire, persistance, anti-triche', () => {
  it('lobby → 2 questions (mcq + truefalse) → podium, avec bonus de rapidité et persistance vérifiée en base', async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      // ---- 1. Hôte : inscription → cookie → quiz à 2 questions via l'API éditeur. ----
      const cookie = await signUp(app, 'e2e-host@example.com')

      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz e2e complet' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }

      // Q1 (mcq) — chrono court (5s) pour que le bonus de rapidité soit mesurable de façon
      // fiable sur un délai de test raisonnable, sans dépendre d'un timing sub-milliseconde.
      const q1Res = await app.inject({
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
      expect(q1Res.statusCode).toBe(201)
      const q1 = q1Res.json() as { id: string }

      // Q2 (truefalse) — manche plus légère.
      const q2Res = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: {
          type: 'truefalse',
          prompt: 'La Terre est ronde.',
          timeLimit: 5,
          readingTime: 0,
          payload: { correct: true },
        },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(q2Res.statusCode).toBe(201)

      // ---- 2. host:create ----
      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)

      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocket,
        'host:create',
        { quizId: quiz.id },
      )
      expect(created.error).toBeUndefined()
      expect(created.pin).toMatch(/^\d{6}$/)
      const { pin } = created as { sessionId: string; pin: string }

      // ---- 3. 3 joueurs rejoignent par PIN ; lobby:update reflète 3 joueurs. ----
      const player1 = await connectClient(url) // Alice : rapide, correcte
      const player2 = await connectClient(url) // Bob : lente, correcte
      const player3 = await connectClient(url) // Carol : incorrecte
      clients.push(player1, player2, player3)

      const lobbyUpdates = collect<{ players: Array<{ id: string; nickname: string }> }>(hostSocket, 'lobby:update')

      const join1 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player1, 'player:join', { pin, nickname: 'Alice' },
      )
      const join2 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player2, 'player:join', { pin, nickname: 'Bob' },
      )
      const join3 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player3, 'player:join', { pin, nickname: 'Carol' },
      )
      for (const j of [join1, join2, join3]) {
        expect(j.error).toBeUndefined()
        expect(j.playerId).toBeTruthy()
        expect(j.joinToken).toBeTruthy()
      }
      const alicePlayerId = join1.playerId!
      const bobPlayerId = join2.playerId!
      const carolPlayerId = join3.playerId!

      const lobbyAfterAll = await lobbyUpdates.atLeast(3)
      expect(lobbyAfterAll.players).toHaveLength(3)
      expect(new Set(lobbyAfterAll.players.map((p) => p.nickname))).toEqual(new Set(['Alice', 'Bob', 'Carol']))

      // ============================================================================
      // Q1 (mcq) : host:start → question:show SANS bonne réponse (anti-triche fort).
      // ============================================================================
      const show1 = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player1, 'question:show')
      const show2 = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player2, 'question:show')
      const show3 = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player3, 'question:show')

      const startAck = await ack<{ payload?: { options: Array<Record<string, unknown>> }; error?: string }>(
        hostSocket, 'host:start', {},
      )
      expect(startAck.error).toBeUndefined()

      const shows = await Promise.all([show1, show2, show3])
      for (const show of [...shows, startAck as { payload: { options: Array<Record<string, unknown>> } }]) {
        expect(show.payload).toBeDefined()
        for (const option of show.payload.options) {
          expect(option).not.toHaveProperty('correct')
        }
        expect(JSON.stringify(show)).not.toContain('correct')
      }
      // Les labels des options restent (légitimement) visibles aux joueurs — playerView ne
      // retire QUE `correct`, pas les options elles-mêmes (les joueurs doivent pouvoir choisir).
      expect(JSON.stringify(shows[0])).toContain('Paris')
      expect(JSON.stringify(shows[0])).toContain('Lyon')

      // ---- 5. Réponses : Alice rapide-correcte, Bob lent-correct, Carol incorrecte. ----
      const answer1 = await ack<{ accepted?: boolean; error?: string }>(
        player1, 'player:answer', { answer: { optionIndex: 0 } }, // Paris
      )
      expect(answer1.accepted).toBe(true)

      // Écart réel de temps mesuré serveur (Date.now() au gateway) entre Alice et Bob : 300ms,
      // largement supérieur au jitter possible du test runner local, sur un timeLimit de 5s
      // (maxMs=5000ms) — garantit un écart de bonus de rapidité net et non-flaky.
      await sleep(300)

      const answer2 = await ack<{ accepted?: boolean; error?: string }>(
        player2, 'player:answer', { answer: { optionIndex: 0 } }, // Paris
      )
      expect(answer2.accepted).toBe(true)

      const answer3 = await ack<{ accepted?: boolean; error?: string }>(
        player3, 'player:answer', { answer: { optionIndex: 1 } }, // Lyon (mauvais)
      )
      expect(answer3.accepted).toBe(true)

      // ---- 6. host:reveal → question:reveal contient la bonne réponse + distribution. ----
      const revealPromise = waitFor<{ correct: unknown; distribution: Record<string, number> }>(
        player1, 'question:reveal',
      )
      const scoreboardPromise = waitFor<{ ranking: Array<{ playerId: string; nickname: string; score: number }> }>(
        player1, 'scoreboard',
      )
      const revealAck = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck.error).toBeUndefined()

      const reveal1 = await revealPromise
      expect(reveal1.correct).toBeDefined()
      expect(JSON.stringify(reveal1.correct)).toContain('Paris') // la bonne réponse fuit ENFIN, après reveal
      expect(Object.values(reveal1.distribution).reduce((a, b) => a + b, 0)).toBe(3)

      const scoreboard1 = await scoreboardPromise
      const rankQ1 = new Map(scoreboard1.ranking.map((r) => [r.playerId, r.score]))
      const aliceQ1 = rankQ1.get(alicePlayerId)!
      const bobQ1 = rankQ1.get(bobPlayerId)!
      const carolQ1 = rankQ1.get(carolPlayerId)!

      // Scoring serveur-autoritaire : les deux correctes ont des points, le bonus de rapidité
      // favorise Alice (rapide) sur Bob (lente) ; Carol (incorrecte) est à 0.
      expect(aliceQ1).toBeGreaterThan(0)
      expect(bobQ1).toBeGreaterThan(0)
      expect(aliceQ1).toBeGreaterThan(bobQ1)
      expect(carolQ1).toBe(0)

      // ============================================================================
      // Q2 (truefalse) : host:next → manche plus légère, même garde-fous.
      // ============================================================================
      const q2Show1 = waitFor<{ payload: Record<string, unknown> }>(player1, 'question:show')
      const q2Show2 = waitFor<{ payload: Record<string, unknown> }>(player2, 'question:show')
      const q2Show3 = waitFor<{ payload: Record<string, unknown> }>(player3, 'question:show')

      const nextAck1 = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck1.error).toBeUndefined()
      expect(nextAck1.phase).toBe('question')

      const q2Shows = await Promise.all([q2Show1, q2Show2, q2Show3])
      for (const show of q2Shows) {
        expect(JSON.stringify(show)).not.toContain('correct') // truefalse.playerView() === {} : rien à fuiter
      }

      const q2Answer1 = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { value: true } })
      expect(q2Answer1.accepted).toBe(true)
      await sleep(300)
      const q2Answer2 = await ack<{ accepted?: boolean }>(player2, 'player:answer', { answer: { value: true } })
      expect(q2Answer2.accepted).toBe(true)
      const q2Answer3 = await ack<{ accepted?: boolean }>(player3, 'player:answer', { answer: { value: false } })
      expect(q2Answer3.accepted).toBe(true)

      const reveal2Promise = waitFor<{ correct: unknown; distribution: Record<string, number> }>(player1, 'question:reveal')
      const scoreboard2Promise = waitFor<{ ranking: Array<{ playerId: string; nickname: string; score: number }> }>(
        player1, 'scoreboard',
      )
      const revealAck2 = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck2.error).toBeUndefined()

      const reveal2 = await reveal2Promise
      expect(JSON.stringify(reveal2.correct)).toContain('true')

      // ---- 8. host:next à nouveau : plus de questions → podium. ----
      const scoreboard2 = await scoreboard2Promise
      const rankQ2Cumulative = new Map(scoreboard2.ranking.map((r) => [r.playerId, r.score]))
      const aliceCumulative = rankQ2Cumulative.get(alicePlayerId)!
      const bobCumulative = rankQ2Cumulative.get(bobPlayerId)!
      const carolCumulative = rankQ2Cumulative.get(carolPlayerId)!

      expect(aliceCumulative).toBeGreaterThan(bobCumulative)
      expect(bobCumulative).toBeGreaterThan(carolCumulative)
      expect(carolCumulative).toBe(0) // toujours incorrecte sur les 2 manches

      const podiumPromise = waitFor<{ top: Array<{ playerId: string; nickname: string; score: number }> }>(player1, 'podium')
      const nextAck2 = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck2.error).toBeUndefined()
      expect(nextAck2.phase).toBe('podium')

      const podium = await podiumPromise
      expect(podium.top.length).toBe(3)
      expect(podium.top[0].playerId).toBe(alicePlayerId)
      expect(podium.top[0].score).toBe(aliceCumulative)
      expect(podium.top[1].playerId).toBe(bobPlayerId)
      expect(podium.top[2].playerId).toBe(carolPlayerId)

      // ============================================================================
      // 9. Vérification en base : game_session ended, session_player.total_score cohérent
      //    avec le podium/scoreboard, answer_record avec is_correct/points corrects.
      // ============================================================================
      const [dbSession] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.quizId, quiz.id))
      expect(dbSession).toBeDefined()
      expect(dbSession.status).toBe('ended')
      expect(dbSession.startedAt).not.toBeNull()
      expect(dbSession.endedAt).not.toBeNull()

      const dbPlayers = await ctx.db.select().from(schema.sessionPlayer).where(eq(schema.sessionPlayer.sessionId, dbSession.id))
      expect(dbPlayers).toHaveLength(3)
      const dbPlayerByNickname = new Map(dbPlayers.map((p) => [p.nickname, p]))

      const aliceDb = dbPlayerByNickname.get('Alice')!
      const bobDb = dbPlayerByNickname.get('Bob')!
      const carolDb = dbPlayerByNickname.get('Carol')!
      expect(aliceDb.totalScore).toBe(aliceCumulative)
      expect(bobDb.totalScore).toBe(bobCumulative)
      expect(carolDb.totalScore).toBe(carolCumulative)
      expect(aliceDb.totalScore).toBeGreaterThan(bobDb.totalScore)
      expect(bobDb.totalScore).toBeGreaterThan(carolDb.totalScore)
      expect(carolDb.totalScore).toBe(0)

      const dbAnswers = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
      // 3 joueurs × 2 questions = 6 réponses persistées.
      expect(dbAnswers).toHaveLength(6)

      const answersByPlayerId = new Map<string, typeof dbAnswers>()
      for (const row of dbAnswers) {
        const list = answersByPlayerId.get(row.playerId) ?? []
        list.push(row)
        answersByPlayerId.set(row.playerId, list)
      }

      const aliceAnswers = answersByPlayerId.get(aliceDb.id) ?? []
      const bobAnswers = answersByPlayerId.get(bobDb.id) ?? []
      const carolAnswers = answersByPlayerId.get(carolDb.id) ?? []
      expect(aliceAnswers).toHaveLength(2)
      expect(bobAnswers).toHaveLength(2)
      expect(carolAnswers).toHaveLength(2)

      // Alice/Bob : toujours correctes, points > 0 sur chaque manche ; leur somme = total_score.
      for (const row of aliceAnswers) {
        expect(row.isCorrect).toBe(true)
        expect(row.points).toBeGreaterThan(0)
      }
      for (const row of bobAnswers) {
        expect(row.isCorrect).toBe(true)
        expect(row.points).toBeGreaterThan(0)
      }
      // Carol : toujours incorrecte, 0 point.
      for (const row of carolAnswers) {
        expect(row.isCorrect).toBe(false)
        expect(row.points).toBe(0)
      }
      expect(aliceAnswers.reduce((sum, r) => sum + r.points, 0)).toBe(aliceDb.totalScore)
      expect(bobAnswers.reduce((sum, r) => sum + r.points, 0)).toBe(bobDb.totalScore)
      expect(carolAnswers.reduce((sum, r) => sum + r.points, 0)).toBe(carolDb.totalScore)

      // Bonus de rapidité persisté fidèlement : sur Q1 (mcq, identifiée par son id renvoyé à la
      // création), les points d'Alice (rapide) dépassent ceux de Bob (lent) — même assertion
      // qu'en mémoire (scoreboard1), mais relue depuis la base pour prouver la persistance fidèle.
      const aliceQ1Row = aliceAnswers.find((r) => r.questionId === q1.id)!
      const bobQ1Row = bobAnswers.find((r) => r.questionId === q1.id)!
      expect(aliceQ1Row).toBeDefined()
      expect(bobQ1Row).toBeDefined()
      expect(aliceQ1Row.points).toBe(aliceQ1)
      expect(bobQ1Row.points).toBe(bobQ1)
      expect(aliceQ1Row.points).toBeGreaterThan(bobQ1Row.points)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)
})
