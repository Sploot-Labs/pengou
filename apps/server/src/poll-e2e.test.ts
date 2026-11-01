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

// e2e du sondage : révélation manuelle (choix multiple) ou automatique (choix unique), répartition
// jointe à `question:reveal`, persistance sans point, rejeu de la révélation (pas du classement)
// aux écrans et à l'hôte qui se reconnectent, « Passer » sans classement, et `podium` qui dit si le
// quiz contenait des questions notées. Mêmes utilitaires que `wordcloud-e2e.test.ts`.

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
    payload: { email, password: 'motdepasse-123456', name: 'Hôte sondage' },
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
function record<T = unknown>(client: ClientSocket, event: string): {
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

/** Noms des événements reçus par `client`, dans l'ordre d'arrivée (tous événements confondus). */
function eventLog(client: ClientSocket): string[] {
  const names: string[] = []
  client.onAny((event: string) => names.push(event))
  return names
}

type PollView = {
  questionId: string
  multiple: boolean
  voters: number
  options: Array<{ label: string; votes: number }>
}
type RevealPayload = { correct: unknown; distribution: Record<string, number>; poll?: PollView }
type PodiumPayload = {
  top: Array<{ playerId: string; nickname: string; score: number }>
  sources: unknown[]
  hasScoredQuestions: boolean
}
type ShowPayload = { id: string; type: string }

async function createQuiz(app: FastifyInstance, cookie: string, title: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/quizzes',
    payload: { title },
    headers: { 'content-type': 'application/json', cookie },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

async function addQuestion(app: FastifyInstance, cookie: string, quizId: string, question: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/quizzes/${quizId}/questions`,
    // Chrono long : aucune révélation par expiration pendant le test.
    payload: { timeLimit: 120, readingTime: 0, ...question },
    headers: { 'content-type': 'application/json', cookie },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

function pollQuestion(prompt: string, labels: string[], multiple: boolean): Record<string, unknown> {
  return { type: 'poll', prompt, payload: { options: labels.map((label) => ({ label })), multiple } }
}

async function rowsFor(questionId: string) {
  return ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.questionId, questionId))
}

describe('e2e : sondage', () => {
  it('révélation avec répartition, persistance sans point, rejeu sans classement, « Passer », podium noté', async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'sondage-host@example.com')
      const quizId = await createQuiz(app, cookie, 'Quiz sondage')
      const pollMultiId = await addQuestion(app, cookie, quizId, pollQuestion('Vos fruits préférés ?', ['Pomme', 'Poire', 'Kiwi'], true))
      const pollSingleId = await addQuestion(app, cookie, quizId, pollQuestion('Thé ou café ?', ['Thé', 'Café'], false))
      const pollSkipId = await addQuestion(app, cookie, quizId, pollQuestion('Mer ou montagne ?', ['Mer', 'Montagne'], true))
      await addQuestion(app, cookie, quizId, {
        type: 'mcq',
        prompt: 'Capitale de la France ?',
        payload: { options: [{ label: 'Paris', correct: true }, { label: 'Lyon', correct: false }] },
      })

      const host = await connectClient(url, { cookie })
      clients.push(host)
      const created = await ack<{ sessionId: string; pin: string; error?: string }>(host, 'host:create', { quizId })
      expect(created.error).toBeUndefined()
      const { sessionId, pin } = created
      // Pas d'avance automatique tant que le test ne l'active pas explicitement.
      const autoOff = await ack<{ ok?: boolean }>(host, 'host:setAuto', { enabled: false })
      expect(autoOff.ok).toBe(true)

      const tokenAck = await ack<{ displayToken: string }>(host, 'host:createScreenToken', {})
      const screen = await connectClient(url)
      clients.push(screen)
      const screenJoin = await ack<{ ok?: boolean }>(screen, 'screen:join', { displayToken: tokenAck.displayToken })
      expect(screenJoin.ok).toBe(true)

      const playerA = await connectClient(url)
      const playerB = await connectClient(url)
      clients.push(playerA, playerB)
      for (const [p, nickname] of [[playerA, 'Alice'], [playerB, 'Bob']] as const) {
        const joined = await ack<{ playerId?: string; error?: string }>(p, 'player:join', { pin, nickname })
        expect(joined.error).toBeUndefined()
      }

      const screenShows = record<ShowPayload>(screen, 'question:show')
      const screenReveals = record<RevealPayload>(screen, 'question:reveal')
      const hostReveals = record<RevealPayload>(host, 'question:reveal')
      const hostScoreboards = record<unknown>(host, 'scoreboard')
      const hostAuto = record<{ nextAt: number | null }>(host, 'auto:advance')
      const hostPodium = record<PodiumPayload>(host, 'podium')
      const hostLog = eventLog(host)

      // ---- Sondage à choix multiple : pas d'auto-révélation, même quand tout le monde a voté. ----
      const startAck = await ack<{ error?: string }>(host, 'host:start', {})
      expect(startAck.error).toBeUndefined()
      await screenShows.until((v) => v.id === pollMultiId)
      const voteA = await ack<{ accepted?: boolean }>(playerA, 'player:answer', { answer: { optionIndexes: [0, 2] } })
      const voteB = await ack<{ accepted?: boolean }>(playerB, 'player:answer', { answer: { optionIndexes: [2] } })
      expect(voteA.accepted).toBe(true)
      expect(voteB.accepted).toBe(true)
      await sleep(600)
      expect(screenReveals.received).toHaveLength(0)

      const revealAck = await ack<{ ok?: boolean }>(host, 'host:reveal', {})
      expect(revealAck.ok).toBe(true)
      const multiReveal = await screenReveals.until(() => true)
      expect(multiReveal.correct).toBeNull()
      expect(multiReveal.poll).toEqual({
        questionId: pollMultiId,
        multiple: true,
        voters: 2,
        options: [{ label: 'Pomme', votes: 1 }, { label: 'Poire', votes: 0 }, { label: 'Kiwi', votes: 2 }],
      })
      await hostScoreboards.until(() => true)
      expect(hostLog.indexOf('scoreboard')).toBeGreaterThan(hostLog.indexOf('question:reveal'))

      const multiRows = await rowsFor(pollMultiId)
      expect(multiRows).toHaveLength(2)
      expect(multiRows.map((r) => (r.answer as { optionIndexes: number[] }).optionIndexes).sort((a, b) => b.length - a.length))
        .toEqual([[0, 2], [2]])
      for (const row of multiRows) {
        expect(row.isCorrect).toBe(false)
        expect(row.points).toBe(0)
      }

      // ---- Grand écran qui se reconnecte après la révélation (session en 'scoreboard') :
      // question puis révélation avec la répartition, pas seulement le classement. ----
      const screen2 = await connectClient(url)
      clients.push(screen2)
      const screen2Log = eventLog(screen2)
      const screen2Reveals = record<RevealPayload>(screen2, 'question:reveal')
      const screen2Shows = record<ShowPayload>(screen2, 'question:show')
      const screenReco = await ack<{ ok?: boolean }>(screen2, 'screen:reconnect', { sessionId, displayToken: tokenAck.displayToken })
      expect(screenReco.ok).toBe(true)
      const replayedShow = await screen2Shows.until(() => true, 2000)
      expect(replayedShow.id).toBe(pollMultiId)
      const replayedReveal = await screen2Reveals.until(() => true, 2000)
      expect(replayedReveal.poll?.voters).toBe(2)
      expect(screen2Log.indexOf('question:show')).toBeLessThan(screen2Log.indexOf('question:reveal'))

      // ---- Hôte qui recharge à ce moment (point de vigilance 2) : phase d'affichage 'reveal'. ----
      const host2 = await connectClient(url, { cookie })
      clients.push(host2)
      const host2Reveals = record<RevealPayload>(host2, 'question:reveal')
      const hostReco = await ack<{ phase?: string; error?: string }>(host2, 'host:reconnect', { sessionId })
      expect(hostReco.error).toBeUndefined()
      expect(hostReco.phase).toBe('reveal')
      const host2Reveal = await host2Reveals.until(() => true, 2000)
      expect(host2Reveal.poll?.voters).toBe(2)

      // ---- Sondage à choix unique : vote invalide refusé, auto-révélation au second vote, puis
      // avance automatique vers la question suivante sans geste de l'hôte. ----
      const autoOn = await ack<{ ok?: boolean }>(host, 'host:setAuto', { enabled: true, delaySeconds: 1 })
      expect(autoOn.ok).toBe(true)
      // L'activation en pleine étape classement planifie déjà l'avance vers le sondage suivant.
      await screenShows.until((v) => v.id === pollSingleId, 3000)
      const revealsBeforeSingle = hostReveals.received.length

      const bad = await ack<{ accepted?: boolean; reason?: string }>(playerA, 'player:answer', { answer: { optionIndexes: [0, 1] } })
      expect(bad.accepted).toBe(false)
      expect(bad.reason).toBe('réponse invalide pour ce type de question')
      const goodA = await ack<{ accepted?: boolean }>(playerA, 'player:answer', { answer: { optionIndexes: [1] } })
      expect(goodA.accepted).toBe(true)
      expect(hostReveals.received.length).toBe(revealsBeforeSingle)
      const goodB = await ack<{ accepted?: boolean }>(playerB, 'player:answer', { answer: { optionIndexes: [0] } })
      expect(goodB.accepted).toBe(true)

      const singleReveal = await hostReveals.until((v) => v.poll?.questionId === pollSingleId, 3000)
      expect(singleReveal.poll?.voters).toBe(2)
      expect(singleReveal.poll?.options.map((o) => o.votes)).toEqual([1, 1])
      const revealPos = hostLog.lastIndexOf('question:reveal')
      const autoAfterReveal = await hostAuto.until((v) => v.nextAt !== null && hostLog.lastIndexOf('auto:advance') > revealPos, 3000)
      expect(autoAfterReveal.nextAt).not.toBeNull()
      await screenShows.until((v) => v.id === pollSkipId, 4000)
      const autoOff2 = await ack<{ ok?: boolean }>(host, 'host:setAuto', { enabled: false })
      expect(autoOff2.ok).toBe(true)

      const singleRows = await rowsFor(pollSingleId)
      expect(singleRows.map((r) => (r.answer as { optionIndexes: number[] }).optionIndexes[0]).sort()).toEqual([0, 1])
      for (const row of singleRows) {
        expect(row.isCorrect).toBe(false)
        expect(row.points).toBe(0)
      }

      // ---- « Passer » sur un sondage : ni révélation ni classement, question suivante aussitôt,
      // votes déjà donnés persistés. ----
      const skipVote = await ack<{ accepted?: boolean }>(playerA, 'player:answer', { answer: { optionIndexes: [1] } })
      expect(skipVote.accepted).toBe(true)
      const revealsBeforeSkip = hostReveals.received.length
      const scoreboardsBeforeSkip = hostScoreboards.received.length
      const skipAck = await ack<{ ok?: boolean; error?: string }>(host, 'host:skip', {})
      expect(skipAck.error).toBeUndefined()
      expect(skipAck.ok).toBe(true)
      const mcqShow = await screenShows.until((v) => v.type === 'mcq', 1000)
      expect(mcqShow.type).toBe('mcq')
      await sleep(300)
      expect(hostReveals.received.length).toBe(revealsBeforeSkip)
      expect(hostScoreboards.received.length).toBe(scoreboardsBeforeSkip)
      const skipRows = await rowsFor(pollSkipId)
      expect(skipRows).toHaveLength(1)
      expect(skipRows[0].answer).toEqual({ optionIndexes: [1] })
      expect(skipRows[0].points).toBe(0)

      // ---- Question notée, tout le monde se trompe : le podium reste affiché (vigilance 4). ----
      for (const p of [playerA, playerB]) {
        const answered = await ack<{ accepted?: boolean }>(p, 'player:answer', { answer: { optionIndex: 1 } })
        expect(answered.accepted).toBe(true)
      }
      await hostReveals.until((v) => v.poll === undefined, 3000)
      const nextAck = await ack<{ phase?: string }>(host, 'host:next', {})
      expect(nextAck.phase).toBe('podium')
      const podium = await hostPodium.until(() => true)
      expect(podium.hasScoredQuestions).toBe(true)
      expect(podium.top).toHaveLength(2)
      expect(podium.top.every((e) => e.score === 0)).toBe(true)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)

  it('quiz sans question notée : podium sans classement, rejoué tel quel à la reconnexion de l\'hôte', async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'sondage-seul@example.com')
      const quizId = await createQuiz(app, cookie, 'Sondage seul')
      await addQuestion(app, cookie, quizId, pollQuestion('Thé ou café ?', ['Thé', 'Café'], false))

      const host = await connectClient(url, { cookie })
      clients.push(host)
      const created = await ack<{ sessionId: string; pin: string; error?: string }>(host, 'host:create', { quizId })
      expect(created.error).toBeUndefined()
      await ack(host, 'host:setAuto', { enabled: false })

      const player = await connectClient(url)
      clients.push(player)
      const joined = await ack<{ error?: string }>(player, 'player:join', { pin: created.pin, nickname: 'Alice' })
      expect(joined.error).toBeUndefined()

      const hostReveals = record<RevealPayload>(host, 'question:reveal')
      const hostPodium = record<PodiumPayload>(host, 'podium')
      await ack(host, 'host:start', {})
      const vote = await ack<{ accepted?: boolean }>(player, 'player:answer', { answer: { optionIndexes: [1] } })
      expect(vote.accepted).toBe(true)
      await hostReveals.until(() => true, 3000)

      const nextAck = await ack<{ phase?: string }>(host, 'host:next', {})
      expect(nextAck.phase).toBe('podium')
      const podium = await hostPodium.until(() => true)
      expect(podium).toEqual({ top: [], sources: [], hasScoredQuestions: false })

      const host2 = await connectClient(url, { cookie })
      clients.push(host2)
      const host2Podium = record<PodiumPayload>(host2, 'podium')
      const reco = await ack<{ phase?: string; error?: string }>(host2, 'host:reconnect', { sessionId: created.sessionId })
      expect(reco.error).toBeUndefined()
      expect(reco.phase).toBe('podium')
      const replayed = await host2Podium.until(() => true, 2000)
      expect(replayed).toEqual({ top: [], sources: [], hasScoredQuestions: false })
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)
})
