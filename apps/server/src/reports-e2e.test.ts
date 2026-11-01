import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import {
  startTestDb, runMigrations, schema, tenantScope, createQuiz, setWordcloudRemoved,
  createGameSession, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
  type SessionSummary, type SessionReport,
} from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, MemorySessionStore, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'

// e2e Task 6 (Plan 7 — Dashboard & rapports) : joue une VRAIE partie de bout en bout (même
// harnais que game-e2e.test.ts — lobby → 2 questions → podium, scores différenciés par un
// mix correct/incorrect + des timings différents), puis consulte le rapport via l'API REST
// authentifiée (`/api/sessions…`, Task 3) et vérifie que les agrégats renvoyés correspondent
// RÉELLEMENT au déroulé joué (pas seulement leur forme), que le CSV exporté est réel (BOM +
// contenu), et que l'isolation tenant tient sur les trois routes.

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
    payload: { email, password: 'motdepasse-123456', name: 'Hôte rapport e2e' },
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
  // registerEditor câble aussi registerReportRoutes (/api/sessions…) — voir editor.ts.
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

function waitFor<T = unknown>(client: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => client.once(event, (payload: T) => resolve(payload)))
}

/** Collecte tous les événements `event` reçus — même utilitaire que game-e2e.test.ts. */
function collect<T = unknown>(client: ClientSocket, event: string): {
  atLeast: (n: number) => Promise<T>
  until: (predicate: (payload: T) => boolean) => Promise<T>
} {
  const received: T[] = []
  const waiters: Array<{ n: number; resolve: (v: T) => void }> = []
  const matchers: Array<{ predicate: (payload: T) => boolean; resolve: (v: T) => void }> = []
  client.on(event, (payload: T) => {
    received.push(payload)
    for (const w of [...waiters]) {
      if (received.length >= w.n) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(received[w.n - 1])
      }
    }
    for (const m of [...matchers]) {
      if (m.predicate(payload)) {
        matchers.splice(matchers.indexOf(m), 1)
        m.resolve(payload)
      }
    }
  })
  return {
    atLeast(n: number) {
      if (received.length >= n) return Promise.resolve(received[n - 1])
      return new Promise((resolve) => waiters.push({ n, resolve }))
    },
    // Premier payload (déjà reçu ou à venir) qui satisfait `predicate` : la diffusion du lobby
    // étant coalescée, on attend un état (ex. « 3 joueurs ») plutôt qu'un nombre d'événements.
    until(predicate: (payload: T) => boolean) {
      const found = received.find(predicate)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => matchers.push({ predicate, resolve }))
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Seed direct en base d'une session terminée dans un tenant ÉTRANGER (jamais rejoint par
 * l'hôte de la partie jouée) — même pattern que routes-sessions.test.ts, pour prouver
 * l'isolation cross-tenant sur les trois routes de rapport. */
async function seedForeignSession(): Promise<string> {
  const [foreignTenant] = await ctx.db.insert(schema.tenant).values({ name: 'Étranger e2e rapports' }).returning()
  const [foreignOwner] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'etranger-rapports@x.fr', name: 'Étranger', emailVerified: false })
    .returning()
  const scope = tenantScope(ctx.db, foreignTenant.id)
  const quiz = await createQuiz(scope, { ownerId: foreignOwner.id, title: 'Quiz étranger' })
  const [question] = await ctx.db.insert(schema.question).values({
    quizId: quiz.id, tenantId: foreignTenant.id, type: 'mcq', prompt: 'Q étrangère', timeLimit: 20, orderIndex: 0,
    payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
  }).returning()

  const session = await createGameSession(scope, { quizId: quiz.id, hostId: foreignOwner.id, pin: '888888' })
  const sessionId = session!.id
  const dave = await addSessionPlayer(ctx.db, sessionId, { nickname: 'Dave', joinToken: 'tok-dave' })
  await recordAnswer(ctx.db, {
    sessionId, questionId: question.id, playerId: dave.id, answer: { choice: 0 }, timeMs: 1000, isCorrect: true, points: 900,
  })
  await setPlayerScore(ctx.db, dave.id, 900)
  await setSessionStatus(ctx.db, sessionId, 'ended')
  return sessionId
}

describe('e2e — jouer une partie puis consulter le rapport (liste, détail, CSV, isolation)', () => {
  it('joue lobby→podium (3 joueurs, 2 questions, scores différenciés) puis vérifie que /api/sessions… reflète fidèlement le déroulé', async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      // ---- 1. Hôte : inscription → cookie → quiz à 2 questions. ----
      const cookie = await signUp(app, 'e2e-reports-host@example.com')

      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz rapport e2e' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }

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
      const q2 = q2Res.json() as { id: string }

      // ---- 2. host:create ----
      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)

      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocket, 'host:create', { quizId: quiz.id },
      )
      expect(created.error).toBeUndefined()
      expect(created.pin).toMatch(/^\d{6}$/)
      const { pin } = created as { sessionId: string; pin: string }

      // ---- 3. 3 joueurs rejoignent. ----
      const player1 = await connectClient(url) // Alice : rapide, correcte sur les 2 manches
      const player2 = await connectClient(url) // Bob : lente, correcte sur les 2 manches
      const player3 = await connectClient(url) // Carol : incorrecte sur les 2 manches
      clients.push(player1, player2, player3)

      const lobbyUpdates = collect<{ players: Array<{ id: string; nickname: string }> }>(hostSocket, 'lobby:update')

      const join1 = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      const join2 = await ack<{ playerId?: string; error?: string }>(player2, 'player:join', { pin, nickname: 'Bob' })
      const join3 = await ack<{ playerId?: string; error?: string }>(player3, 'player:join', { pin, nickname: 'Carol' })
      for (const j of [join1, join2, join3]) {
        expect(j.error).toBeUndefined()
        expect(j.playerId).toBeTruthy()
      }
      const alicePlayerId = join1.playerId!
      const bobPlayerId = join2.playerId!
      const carolPlayerId = join3.playerId!

      // Diffusion coalescée : on attend l'état final (3 joueurs), pas un événement par arrivée.
      await lobbyUpdates.until((u) => u.players.length === 3)

      // ============================================================================
      // Q1 (mcq) : Alice rapide-correcte, Bob lent-correct (écart de 300ms mesuré
      // serveur), Carol incorrecte.
      // ============================================================================
      const show1 = waitFor(player1, 'question:show')
      const show2 = waitFor(player2, 'question:show')
      const show3 = waitFor(player3, 'question:show')
      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()
      await Promise.all([show1, show2, show3])

      const answer1 = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } }) // Paris
      expect(answer1.accepted).toBe(true)
      await sleep(300)
      const answer2 = await ack<{ accepted?: boolean }>(player2, 'player:answer', { answer: { optionIndex: 0 } }) // Paris
      expect(answer2.accepted).toBe(true)
      const answer3 = await ack<{ accepted?: boolean }>(player3, 'player:answer', { answer: { optionIndex: 1 } }) // Lyon
      expect(answer3.accepted).toBe(true)

      const scoreboardPromise = waitFor<{ ranking: Array<{ playerId: string; score: number }> }>(player1, 'scoreboard')
      const revealAck = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck.error).toBeUndefined()
      const scoreboard1 = await scoreboardPromise
      const rankQ1 = new Map(scoreboard1.ranking.map((r) => [r.playerId, r.score]))
      const aliceQ1 = rankQ1.get(alicePlayerId)!
      const bobQ1 = rankQ1.get(bobPlayerId)!
      expect(aliceQ1).toBeGreaterThan(bobQ1)

      // ============================================================================
      // Q2 (truefalse) : même schéma de réponses → écarts de score maintenus.
      // ============================================================================
      const q2Show1 = waitFor(player1, 'question:show')
      const q2Show2 = waitFor(player2, 'question:show')
      const q2Show3 = waitFor(player3, 'question:show')
      const nextAck1 = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck1.error).toBeUndefined()
      expect(nextAck1.phase).toBe('question')
      await Promise.all([q2Show1, q2Show2, q2Show3])

      const q2Answer1 = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { value: true } })
      expect(q2Answer1.accepted).toBe(true)
      await sleep(300)
      const q2Answer2 = await ack<{ accepted?: boolean }>(player2, 'player:answer', { answer: { value: true } })
      expect(q2Answer2.accepted).toBe(true)
      const q2Answer3 = await ack<{ accepted?: boolean }>(player3, 'player:answer', { answer: { value: false } })
      expect(q2Answer3.accepted).toBe(true)

      const scoreboard2Promise = waitFor<{ ranking: Array<{ playerId: string; score: number }> }>(player1, 'scoreboard')
      const revealAck2 = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck2.error).toBeUndefined()
      const scoreboard2 = await scoreboard2Promise
      const rankFinal = new Map(scoreboard2.ranking.map((r) => [r.playerId, r.score]))
      const aliceFinal = rankFinal.get(alicePlayerId)!
      const bobFinal = rankFinal.get(bobPlayerId)!
      const carolFinal = rankFinal.get(carolPlayerId)!
      expect(aliceFinal).toBeGreaterThan(bobFinal)
      expect(bobFinal).toBeGreaterThan(carolFinal)
      expect(carolFinal).toBe(0)

      // ---- host:next → podium (fin de partie). Capture le podium comme référence. ----
      const podiumPromise = waitFor<{ top: Array<{ playerId: string; nickname: string; score: number }> }>(player1, 'podium')
      const nextAck2 = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck2.error).toBeUndefined()
      expect(nextAck2.phase).toBe('podium')
      const podium = await podiumPromise
      expect(podium.top.length).toBe(3)
      const podiumScoreByNickname = new Map(podium.top.map((p) => [p.nickname, p.score]))
      expect(podiumScoreByNickname.get('Alice')).toBe(aliceFinal)
      expect(podiumScoreByNickname.get('Bob')).toBe(bobFinal)
      expect(podiumScoreByNickname.get('Carol')).toBe(carolFinal)

      // ============================================================================
      // 4. Résoudre l'id de session jouée via /api/sessions (liste), pour n'utiliser
      //    QUE l'API REST authentifiée à partir d'ici (comme un vrai hôte le ferait).
      // ============================================================================
      const listRes = await app.inject({ method: 'GET', url: '/api/sessions', headers: { cookie } })
      expect(listRes.statusCode).toBe(200)
      const summaries = listRes.json() as SessionSummary[]
      const summary = summaries.find((s) => s.pin === pin)
      expect(summary).toBeDefined()
      expect(summary!.quizTitle).toBe('Quiz rapport e2e')
      expect(summary!.playerCount).toBe(3)
      const sessionId = summary!.id

      // ============================================================================
      // 5. GET /api/sessions/:id — les agrégats correspondent EXACTEMENT au déroulé joué.
      // ============================================================================
      const detailRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers: { cookie } })
      expect(detailRes.statusCode).toBe(200)
      const report = detailRes.json() as SessionReport
      expect(report.session.id).toBe(sessionId)
      expect(report.session.pin).toBe(pin)
      expect(report.session.quizTitle).toBe('Quiz rapport e2e')

      // Joueurs triés par score décroissant ; totalScore == score crédité par le moteur pendant
      // la partie (cross-check direct contre le podium capturé plus haut).
      const playerByNickname = new Map(report.players.map((p) => [p.nickname, p]))
      const aliceReport = playerByNickname.get('Alice')!
      const bobReport = playerByNickname.get('Bob')!
      const carolReport = playerByNickname.get('Carol')!
      expect(aliceReport.totalScore).toBe(aliceFinal)
      expect(bobReport.totalScore).toBe(bobFinal)
      expect(carolReport.totalScore).toBe(carolFinal)
      expect(report.players.map((p) => p.totalScore)).toEqual(
        [...report.players.map((p) => p.totalScore)].sort((a, b) => b - a),
      )
      expect(report.players[0].nickname).toBe('Alice') // la joueuse la plus rapide-correcte a le meilleur score

      // Réponses correctes/total par joueur : chacun a répondu aux 2 questions, Alice/Bob
      // toujours correctes, Carol jamais.
      expect(aliceReport.answerCount).toBe(2)
      expect(aliceReport.correctCount).toBe(2)
      expect(bobReport.answerCount).toBe(2)
      expect(bobReport.correctCount).toBe(2)
      expect(carolReport.answerCount).toBe(2)
      expect(carolReport.correctCount).toBe(0)

      // Par question : 3 réponses données, 2 correctes (Alice+Bob), pour Q1 comme Q2.
      const questionByOrder = new Map(report.questions.map((q) => [q.orderIndex, q]))
      const q1Report = questionByOrder.get(0)!
      const q2Report = questionByOrder.get(1)!
      expect(q1Report.questionId).toBe(q1.id)
      expect(q1Report.answerCount).toBe(3)
      expect(q1Report.correctCount).toBe(2)
      expect(q1Report.avgTimeMs).not.toBeNull()
      expect(q2Report.questionId).toBe(q2.id)
      expect(q2Report.answerCount).toBe(3)
      expect(q2Report.correctCount).toBe(2)

      // ============================================================================
      // 6. GET /api/sessions/:id/export.csv — CSV réel : 200, content-type, BOM, contenu.
      // ============================================================================
      const csvRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/export.csv`, headers: { cookie } })
      expect(csvRes.statusCode).toBe(200)
      expect(csvRes.headers['content-type']).toMatch(/^text\/csv/)
      const csvBody = csvRes.body
      expect(csvBody.charCodeAt(0)).toBe(0xfeff) // BOM UTF-8 en tête
      expect(csvBody).toContain('Alice')
      expect(csvBody).toContain(String(aliceFinal))
      expect(csvBody).toContain('Bob')
      expect(csvBody).toContain(String(bobFinal))

      // ============================================================================
      // 7. Isolation cross-tenant : une session d'un AUTRE tenant, jamais rejouée par cet
      //    hôte, doit renvoyer 404 sur les trois routes — pas de fuite, pas de 403 (pas
      //    d'oracle d'existence).
      // ============================================================================
      const foreignSessionId = await seedForeignSession()

      const foreignInList = (await app.inject({ method: 'GET', url: '/api/sessions', headers: { cookie } })
        .then((r) => r.json() as SessionSummary[]))
        .some((s) => s.id === foreignSessionId)
      expect(foreignInList).toBe(false)

      const foreignDetail = await app.inject({ method: 'GET', url: `/api/sessions/${foreignSessionId}`, headers: { cookie } })
      expect(foreignDetail.statusCode).toBe(404)

      const foreignCsv = await app.inject({ method: 'GET', url: `/api/sessions/${foreignSessionId}/export.csv`, headers: { cookie } })
      expect(foreignCsv.statusCode).toBe(404)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)
})

describe('export CSV avec un nuage de mots', () => {
  it('exporte le nuage mot par mot et le laisse hors des statistiques', async () => {
    const { app } = await buildApp()
    try {
      const cookie = await signUp(app, 'e2e-wordcloud-csv@example.com')
      const [host] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'e2e-wordcloud-csv@example.com'))
      const [tenantRow] = await ctx.db.select().from(schema.tenant).limit(1)
      const quizRes = await app.inject({
        method: 'POST', url: '/api/quizzes', payload: { title: 'Quiz nuage csv' },
        headers: { 'content-type': 'application/json', cookie },
      })
      const quiz = quizRes.json() as { id: string }
      const [quizRow] = await ctx.db.select().from(schema.quiz).where(eq(schema.quiz.id, quiz.id))
      const tenantId = quizRow.tenantId ?? tenantRow.id
      const [cloud] = await ctx.db.insert(schema.question).values({
        quizId: quiz.id, tenantId, type: 'wordcloud', prompt: 'Un mot sur le matin', timeLimit: 20, orderIndex: 0, payload: {},
      }).returning()
      const session = await createGameSession(tenantScope(ctx.db, tenantId), { quizId: quiz.id, hostId: host.id, pin: '777001' })
      const sessionId = session!.id
      const a = await addSessionPlayer(ctx.db, sessionId, { nickname: 'Ana', joinToken: 'tok-ana-wc' })
      const b = await addSessionPlayer(ctx.db, sessionId, { nickname: 'Ben', joinToken: 'tok-ben-wc' })
      await recordAnswer(ctx.db, { sessionId, questionId: cloud.id, playerId: a.id, answer: { words: ['café', 'rush'] }, timeMs: 1000, isCorrect: false, points: 0 })
      await recordAnswer(ctx.db, { sessionId, questionId: cloud.id, playerId: b.id, answer: { words: ['Café'] }, timeMs: 1000, isCorrect: false, points: 0 })
      await setSessionStatus(ctx.db, sessionId, 'ended')

      const csv = (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/export.csv`, headers: { cookie } })).body
      const lines = csv.split('\r\n')
      expect(lines).toContain('1,Un mot sur le matin,2,,')
      const i = lines.indexOf('"Nuage de mots : Un mot sur le matin (2 participants, 3 mots)"')
      expect(i).toBeGreaterThan(-1)
      expect(lines[i + 1]).toBe('Mot,Occurrences')
      expect(lines[i + 2]).toBe('café,2')
      expect(lines[i + 3]).toBe('rush,1')

      await setWordcloudRemoved(ctx.db, sessionId, cloud.id, ['rush'])
      const csv2 = (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/export.csv`, headers: { cookie } })).body
      expect(csv2).not.toContain('rush')
    } finally {
      await app.close()
    }
  }, 30_000)
})
