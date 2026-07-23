import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { eq } from 'drizzle-orm'
import {
  startTestDb, runMigrations, schema, tenantScope, createQuiz, createQuestion,
} from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, MemorySessionStore, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'

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
    payload: { email, password: 'motdepasse-123456', name: 'Hôte de test' },
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
  const app = buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { db: ctx.db, auth, config })
  const io = attachRealtime(app)

  const engine = createEngine({
    store: new MemorySessionStore(),
    now: () => Date.now(),
    genPin: generatePin,
    genId: () => crypto.randomUUID(),
  })
  registerGameGateway(io, { engine, db: ctx.db, auth, config })

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

/** Course « `event` arrive-t-il sur `client` avant `ms` ? » — résout `true` si le délai gagne
 * (aucun événement reçu, ce qu'on veut prouver pour une action refusée côté serveur), `false`
 * si l'événement arrive quand même (fuite/anomalie à détecter). */
function raceNoEvent(client: ClientSocket, event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      client.off(event, handler)
      resolve(true)
    }, ms)
    client.once(event, handler)
  })
}

/** Collecte tous les événements `event` reçus par `client` (au lieu de `.once`, qui rate un
 * événement émis avant l'enregistrement du listener — race inhérente à 2 joueurs qui rejoignent
 * coup sur coup). `atLeast(n)` résout dès que le n-ième événement est arrivé. */
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

describe('passerelle Socket.IO du jeu (hôte / grand écran / joueurs)', () => {
  it('lobby → question → réponse → reveal → next/podium, sans fuite de la bonne réponse', async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      // 1. Hôte : inscription → cookie → quiz + 1 question mcq via l'API éditeur.
      const cookie = await signUp(app, 'gateway-host@example.com')

      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz gateway' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }

      const questionRes = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: {
          type: 'mcq',
          prompt: 'Capitale de la France ?',
          timeLimit: 20,
          payload: {
            options: [
              { label: 'Paris', correct: true },
              { label: 'Lyon', correct: false },
            ],
          },
        },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(questionRes.statusCode).toBe(201)

      // 2. Socket hôte authentifié (cookie passé au handshake).
      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)

      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocket,
        'host:create',
        { quizId: quiz.id },
      )
      expect(created.error).toBeUndefined()
      expect(created.sessionId).toBeTruthy()
      expect(created.pin).toMatch(/^\d{6}$/)
      const { sessionId, pin } = created as { sessionId: string; pin: string }

      // 3. 2 joueurs anonymes rejoignent par PIN.
      const player1 = await connectClient(url)
      const player2 = await connectClient(url)
      clients.push(player1, player2)

      const lobbyUpdates = collect<{ players: Array<{ id: string }> }>(hostSocket, 'lobby:update')

      const join1 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player1,
        'player:join',
        { pin, nickname: 'Alice' },
      )
      expect(join1.error).toBeUndefined()
      expect(join1.playerId).toBeTruthy()
      expect(join1.joinToken).toBeTruthy()

      const join2 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player2,
        'player:join',
        { pin, nickname: 'Bob' },
      )
      expect(join2.error).toBeUndefined()
      expect(join2.playerId).toBeTruthy()

      const lobbyAfterBoth = await lobbyUpdates.atLeast(2)
      expect(lobbyAfterBoth.players).toHaveLength(2)

      // 4. host:start → les DEUX joueurs reçoivent question:show SANS la bonne réponse
      // (assertion anti-triche forte : aucune option ne porte `correct`).
      const player1Show = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player1, 'question:show')
      const player2Show = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player2, 'question:show')

      const startAck = await ack<{ payload?: { options: Array<Record<string, unknown>> }; error?: string }>(
        hostSocket,
        'host:start',
        {},
      )
      expect(startAck.error).toBeUndefined()

      const [show1, show2] = await Promise.all([player1Show, player2Show])
      for (const show of [show1, show2, startAck as { payload: { options: Array<Record<string, unknown>> } }]) {
        expect(show.payload).toBeDefined()
        for (const option of show.payload.options) {
          expect(option).not.toHaveProperty('correct')
        }
        expect(JSON.stringify(show)).not.toContain('correct')
      }

      // 5. Un joueur répond correctement (index 0 = Paris).
      const answerAck = await ack<{ accepted?: boolean; error?: string }>(
        player1,
        'player:answer',
        { answer: { optionIndex: 0 } },
      )
      expect(answerAck.accepted).toBe(true)

      // 6. host:reveal → question:reveal contient la bonne réponse + la distribution.
      const revealPromise = waitFor<{ correct: unknown; distribution: Record<string, number> }>(
        player1,
        'question:reveal',
      )
      const revealAck = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck.error).toBeUndefined()
      const reveal = await revealPromise
      expect(reveal.correct).toBeDefined()
      expect(JSON.stringify(reveal.correct)).toContain('Paris')
      expect(Object.values(reveal.distribution).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1)

      // 7. host:next : plus de questions → podium.
      const podiumPromise = waitFor<{ top: Array<{ playerId: string; score: number }> }>(player2, 'podium')
      const nextAck = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck.error).toBeUndefined()
      const podium = await podiumPromise
      expect(podium.top.length).toBeGreaterThanOrEqual(1)
      expect(podium.top[0].score).toBeGreaterThan(0)
    } finally {
      // Déconnecter les sockets AVANT de fermer le serveur : sinon `app.close()` attend la
      // fin de connexions socket.io encore ouvertes (transport keep-alive) et bloque jusqu'au
      // timeout du test (même pattern que realtime.test.ts).
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 30_000)

  it("refuse host:create sans session authentifiée", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const anon = await connectClient(url)
      clients.push(anon)
      const res = await ack<{ error?: string; sessionId?: string }>(anon, 'host:create', { quizId: 'nimporte-quoi' })
      expect(res.error).toBeTruthy()
      expect(res.sessionId).toBeUndefined()
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 15_000)

  it("un joueur ne peut pas piloter les événements hôte (host:reveal refusé, aucune fuite sur le fil)", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'gateway-host-authz@example.com')

      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz autorisation hôte' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }

      const questionRes = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: {
          type: 'mcq',
          prompt: 'Q ?',
          timeLimit: 20,
          payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
        },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(questionRes.statusCode).toBe(201)

      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)
      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocket,
        'host:create',
        { quizId: quiz.id },
      )
      expect(created.error).toBeUndefined()
      const { pin } = created as { sessionId: string; pin: string }

      // Un joueur anonyme rejoint — il n'a JAMAIS le rôle 'host' côté passerelle.
      const mallory = await connectClient(url)
      clients.push(mallory)
      const joinRes = await ack<{ playerId?: string; error?: string }>(mallory, 'player:join', { pin, nickname: 'Mallory' })
      expect(joinRes.error).toBeUndefined()
      expect(joinRes.playerId).toBeTruthy()

      // Le joueur tente de piloter le jeu à la place de l'hôte. `requireHost` doit rejeter
      // AVANT tout appel moteur : donc ni `question:reveal` (qui contiendrait la bonne
      // réponse) ni aucun autre événement d'état ne doit jamais être émis suite à cette
      // tentative — on fait courir l'écoute de l'événement contre un court délai.
      const noRevealLeak = raceNoEvent(mallory, 'question:reveal', 500)
      const revealAck = await ack<{ error?: string }>(mallory, 'host:reveal', {})
      expect(revealAck.error).toBeTruthy()
      expect(await noRevealLeak).toBe(true) // le timeout a gagné : aucune fuite

      // Même refus pour host:start et host:next (aucun état ne doit changer non plus).
      const noShowLeak = raceNoEvent(mallory, 'question:show', 500)
      const startAck = await ack<{ error?: string }>(mallory, 'host:start', {})
      expect(startAck.error).toBeTruthy()
      expect(await noShowLeak).toBe(true)

      const noPodiumLeak = raceNoEvent(mallory, 'podium', 500)
      const nextAck = await ack<{ error?: string }>(mallory, 'host:next', {})
      expect(nextAck.error).toBeTruthy()
      expect(await noPodiumLeak).toBe(true)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:create sur un quiz d'un AUTRE tenant est refusé (aucune session créée en base)", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'gateway-tenant-iso@example.com')

      // Tenant B, seedé directement via les repos (même approche que editor-e2e.test.ts) :
      // un tenant + un owner qui lui appartient + un quiz + une question, tous hors du tenant
      // par défaut résolu pour l'hôte authentifié ci-dessus (mode 'single').
      const [foreignTenant] = await ctx.db.insert(schema.tenant).values({ name: 'Tenant étranger (gateway)' }).returning()
      const [foreignOwner] = await ctx.db.insert(schema.user)
        .values({ id: crypto.randomUUID(), email: 'foreign-owner-gateway@x.fr', name: 'Étranger', emailVerified: false })
        .returning()
      const foreignScope = tenantScope(ctx.db, foreignTenant.id)
      const foreignQuiz = await createQuiz(foreignScope, { ownerId: foreignOwner.id, title: 'Quiz étranger (gateway)' })
      await createQuestion(foreignScope, foreignQuiz.id, {
        type: 'mcq',
        prompt: 'Question étrangère',
        timeLimit: 20,
        payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
      })

      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)

      // L'hôte (tenant par défaut) tente de créer une session sur le quiz du tenant étranger.
      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocket,
        'host:create',
        { quizId: foreignQuiz.id },
      )
      expect(created.error).toBeTruthy()
      expect(created.sessionId).toBeUndefined()
      expect(created.pin).toBeUndefined()

      // Aucune ligne game_session n'a été créée pour ce quiz — la garde de scope
      // (listQuestions/createGameSession scopés) a bloqué la persistance, pas seulement l'ack.
      const rows = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.quizId, foreignQuiz.id))
      expect(rows).toHaveLength(0)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)
})
