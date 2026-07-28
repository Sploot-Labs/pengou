import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { eq } from 'drizzle-orm'
import {
  startTestDb, runMigrations, schema, tenantScope, createQuiz, createQuestion, ensureDefaultTenant,
} from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, MemorySessionStore, generatePin, type SessionStore } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'
import { PersistentSessionStore } from './persistent-store.js'

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

// `store` : injectable (Task 4, réhydratation) — `MemorySessionStore` par défaut (comportement
// historique, aucune écriture DB superflue pour les tests qui n'ont pas besoin de survivre à un
// "redémarrage") ; le test « survit à un redémarrage » ci-dessous passe explicitement un
// `PersistentSessionStore(ctx.db)` (deux instances successives, même base — simule un process
// neuf) pour prouver que la réhydratation fonctionne à travers un VRAI aller-retour Postgres.
async function buildApp(store: SessionStore = new MemorySessionStore()): Promise<BuiltApp> {
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

  const engine = createEngine({
    store,
    now: () => Date.now(),
    genPin: generatePin,
    genId: () => crypto.randomUUID(),
  })
  // Réhydratation (Task 4) : `registerGameGateway` réhydrate les sessions actives à son montage
  // — `await` ici garantit qu'elle est terminée avant que le test n'interagisse avec l'app (pas
  // de course entre la reprise et les premiers `player:join`/`host:reconnect` du test).
  await registerGameGateway(io, { engine, db: ctx.db, auth, config })

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
          readingTime: 0,
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
        readingTime: 0,
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

  /** Crée un hôte inscrit + un quiz mono-question (mcq) + une session (host:create) — factorisé
   * pour les tests Task 5 (reconnexion / écran / timer / compteur) qui partagent tous ce setup. */
  async function setupHostedSession(
    app: FastifyInstance,
    url: string,
    email: string,
    timeLimit = 20,
    readingTime = 0,
  ): Promise<{ hostSocket: ClientSocket; sessionId: string; pin: string; quizId: string }> {
    const cookie = await signUp(app, email)
    const quizRes = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz Task 5' },
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
        timeLimit,
        readingTime,
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

    const hostSocket = await connectClient(url, { cookie })
    const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
      hostSocket,
      'host:create',
      { quizId: quiz.id },
    )
    expect(created.error).toBeUndefined()
    return { hostSocket, sessionId: created.sessionId!, pin: created.pin!, quizId: quiz.id }
  }

  /** Variante de `setupHostedSession` avec un `readingTime > 0` (Task 3, phase 'reading') — la
   * route éditeur HTTP (`POST /api/quizzes/:id/questions`) ne porte pas encore ce champ (Task 5,
   * hors périmètre ici), donc la question est insérée directement via le repo `createQuestion`
   * (même tenant — mode 'single' de test, résolu comme `resolveTenantId` le ferait). */
  async function setupHostedSessionWithReading(
    app: FastifyInstance,
    url: string,
    email: string,
    readingTime: number,
    timeLimit = 20,
  ): Promise<{ hostSocket: ClientSocket; sessionId: string; pin: string; quizId: string; cookie: string }> {
    const cookie = await signUp(app, email)
    const quizRes = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz reading' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(quizRes.statusCode).toBe(201)
    const quiz = quizRes.json() as { id: string }

    const tenantId = await ensureDefaultTenant(ctx.db)
    const scope = tenantScope(ctx.db, tenantId)
    await createQuestion(scope, quiz.id, {
      type: 'mcq',
      prompt: 'Capitale de la France ?',
      timeLimit,
      readingTime,
      payload: {
        options: [
          { label: 'Paris', correct: true },
          { label: 'Lyon', correct: false },
        ],
      },
    })

    const hostSocket = await connectClient(url, { cookie })
    const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
      hostSocket,
      'host:create',
      { quizId: quiz.id },
    )
    expect(created.error).toBeUndefined()
    return { hostSocket, sessionId: created.sessionId!, pin: created.pin!, quizId: quiz.id, cookie }
  }

  it("player:reconnect (joinToken) : un joueur déconnecté puis reconnecté retrouve son score et sa place dans la room", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-reconnect@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player1,
        'player:join',
        { pin, nickname: 'Alice' },
      )
      expect(join1.error).toBeUndefined()
      const joinToken = join1.joinToken!

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // Alice répond correctement (index 0 = Paris) → reveal lui créditera des points.
      const answerAck = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answerAck.accepted).toBe(true)

      // Capture le score EXACT crédité par reveal (via `scoreboard`, avant toute déconnexion) —
      // pour comparer une égalité stricte après reconnexion, pas seulement `> 0`.
      const scoreboardPromise = waitFor<{ ranking: Array<{ playerId: string; score: number }> }>(player1, 'scoreboard')
      const revealAck = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck.error).toBeUndefined()
      const scoreboard = await scoreboardPromise
      const aliceEntry = scoreboard.ranking.find((r) => r.playerId === join1.playerId)
      expect(aliceEntry).toBeDefined()
      const scoreBeforeDisconnect = aliceEntry!.score
      expect(scoreBeforeDisconnect).toBeGreaterThan(0)

      // Alice se déconnecte (le serveur doit la marquer non-connectée, sans perdre son score).
      player1.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Reconnexion depuis un NOUVEAU socket (ex. rechargement de page), munie du joinToken.
      const player1b = await connectClient(url)
      clients.push(player1b)
      const reconnectAck = await ack<{ playerId?: string; phase?: string; score?: number; error?: string }>(
        player1b,
        'player:reconnect',
        { pin, joinToken },
      )
      expect(reconnectAck.error).toBeUndefined()
      expect(reconnectAck.playerId).toBeTruthy()
      expect(reconnectAck.phase).toBe('scoreboard') // host:reveal enchaîne engine.scoreboard()
      expect(reconnectAck.score).toBe(scoreBeforeDisconnect) // score EXACTEMENT conservé (pas juste > 0)

      // Le socket reconnecté est bien rattaché à la room : il reçoit les diffusions suivantes
      // (ici `podium`, plus de questions dans ce quiz mono-question).
      const podiumPromise = waitFor<{ top: Array<{ playerId: string; score: number }> }>(player1b, 'podium')
      const nextAck = await ack<{ error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck.error).toBeUndefined()
      const podium = await podiumPromise
      expect(podium.top[0]!.score).toBeGreaterThan(0)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("player:reconnect avec un joinToken invalide/inconnu est refusé", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-reconnect-bad@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      await ack(player1, 'player:join', { pin, nickname: 'Alice' })

      const player2 = await connectClient(url)
      clients.push(player2)
      const res = await ack<{ error?: string; playerId?: string }>(
        player2,
        'player:reconnect',
        { pin, joinToken: 'jeton-inexistant' },
      )
      expect(res.error).toBeTruthy()
      expect(res.playerId).toBeUndefined()
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 15_000)

  it("player:reconnect EN PLEINE QUESTION renvoie question:show (sans bonne réponse) + timer au socket reconnecté, qui peut alors répondre", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-reconnect-midq@example.com', 30)
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player1,
        'player:join',
        { pin, nickname: 'Alice' },
      )
      expect(join1.error).toBeUndefined()
      const joinToken = join1.joinToken!

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // Alice se déconnecte EN PLEINE QUESTION (avant d'avoir répondu) — cas critique : sans
      // la fix, elle ne verrait plus jamais cette question (aveugle jusqu'à la suivante).
      player1.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 150))

      const player1b = await connectClient(url)
      clients.push(player1b)

      // Écouteurs posés AVANT l'appel — le serveur émet `question:show`/`timer` au socket
      // reconnecté de façon synchrone dans le handler `player:reconnect`.
      const showPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player1b, 'question:show')
      const timerPromise = waitFor<{ timeLimit?: number; startedAt?: number }>(player1b, 'timer')

      const reconnectAck = await ack<{ phase?: string; score?: number; error?: string }>(
        player1b,
        'player:reconnect',
        { pin, joinToken },
      )
      expect(reconnectAck.error).toBeUndefined()
      expect(reconnectAck.phase).toBe('question')

      const show = await showPromise
      expect(show.payload).toBeDefined()
      for (const option of show.payload.options) expect(option).not.toHaveProperty('correct')
      expect(JSON.stringify(show)).not.toContain('correct') // anti-triche : même garde que host:start

      const timer = await timerPromise
      expect(timer.timeLimit).toBe(30)

      // Alice peut désormais répondre à la question qu'elle vient de recevoir en reconnectant.
      const answerAck = await ack<{ accepted?: boolean; error?: string }>(
        player1b,
        'player:answer',
        { answer: { optionIndex: 0 } },
      )
      expect(answerAck.accepted).toBe(true)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("un disconnect TARDIF de l'ANCIEN socket (après une reconnexion sur un nouveau socket) ne repasse PAS le joueur à connected:false", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-reconnect-race@example.com')
      clients.push(hostSocket)

      const lobbyUpdates = collect<{ players: Array<{ id: string; connected: boolean }> }>(hostSocket, 'lobby:update')

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(
        player1,
        'player:join',
        { pin, nickname: 'Alice' },
      )
      expect(join1.error).toBeUndefined()
      const { playerId, joinToken } = join1 as { playerId: string; joinToken: string }
      await lobbyUpdates.atLeast(1) // lobby:update du player:join

      await ack<{ error?: string }>(hostSocket, 'host:start', {})

      // Simule la course : un NOUVEAU socket reconnecte AVANT que l'ANCIEN (player1, toujours
      // "connecté" du point de vue du serveur) n'ait émis son événement `disconnect` — exactement
      // le scénario où Socket.IO détecte la coupure d'un client mort avec un peu de retard
      // (~pingTimeout) par rapport à un client qui a déjà rouvert une nouvelle connexion.
      const player1b = await connectClient(url)
      clients.push(player1b)
      const reconnectAck = await ack<{ error?: string; phase?: string }>(
        player1b,
        'player:reconnect',
        { pin, joinToken },
      )
      expect(reconnectAck.error).toBeUndefined()
      await lobbyUpdates.atLeast(2) // lobby:update du player:reconnect

      // MAINTENANT l'ancien socket se déconnecte (le "disconnect tardif").
      player1.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Un nouveau joueur rejoint pour déclencher un `lobby:update` observable et vérifier l'état
      // courant d'Alice — si le garde échouait, le disconnect tardif de l'ancien socket aurait
      // écrasé `connected:false` malgré la reconnexion déjà en place.
      const player2 = await connectClient(url)
      clients.push(player2)
      await ack(player2, 'player:join', { pin, nickname: 'Bob' })
      const lobbyAfter = await lobbyUpdates.atLeast(3)
      const alice = lobbyAfter.players.find((p) => p.id === playerId)
      expect(alice).toBeDefined()
      expect(alice!.connected).toBe(true)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:createScreenToken + screen:join : token d'affichage à usage unique", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-screen@example.com')
      clients.push(hostSocket)

      const tokenAck = await ack<{ displayToken?: string; error?: string }>(hostSocket, 'host:createScreenToken', {})
      expect(tokenAck.error).toBeUndefined()
      expect(tokenAck.displayToken).toBeTruthy()
      const { displayToken } = tokenAck as { displayToken: string }

      // Token inconnu → refusé.
      const badScreen = await connectClient(url)
      clients.push(badScreen)
      const badJoin = await ack<{ error?: string; ok?: boolean }>(badScreen, 'screen:join', { displayToken: 'nimporte-quoi' })
      expect(badJoin.error).toBeTruthy()
      expect(badJoin.ok).toBeUndefined()

      // Token valide → l'écran rejoint en lecture seule (consomme le token).
      const screen = await connectClient(url)
      clients.push(screen)
      const joinRes = await ack<{ ok?: boolean; error?: string }>(screen, 'screen:join', { displayToken })
      expect(joinRes.error).toBeUndefined()
      expect(joinRes.ok).toBe(true)

      // Réutilisation du même token, depuis un autre socket → refusée.
      const screen2 = await connectClient(url)
      clients.push(screen2)
      const reuseJoin = await ack<{ ok?: boolean; error?: string }>(screen2, 'screen:join', { displayToken })
      expect(reuseJoin.error).toBeTruthy()
      expect(reuseJoin.ok).toBeUndefined()

      // Le premier écran (déjà joint AVANT la tentative de réutilisation) garde son accès à la
      // room : il continue de recevoir les diffusions suivantes.
      const lobbyPromise = waitFor<{ players: Array<{ id: string }> }>(screen, 'lobby:update')
      const player1 = await connectClient(url)
      clients.push(player1)
      await ack(player1, 'player:join', { pin, nickname: 'Zoé' })
      const lobby = await lobbyPromise
      expect(lobby.players).toHaveLength(1)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:createScreenToken est refusé pour un socket non-hôte (requireHost, comme les autres commandes hôte)", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-screen-authz@example.com')
      clients.push(hostSocket)

      const mallory = await connectClient(url)
      clients.push(mallory)
      const joinRes = await ack<{ playerId?: string; error?: string }>(mallory, 'player:join', { pin, nickname: 'Mallory' })
      expect(joinRes.error).toBeUndefined()

      const res = await ack<{ displayToken?: string; error?: string }>(mallory, 'host:createScreenToken', {})
      expect(res.error).toBeTruthy()
      expect(res.displayToken).toBeUndefined()
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:start émet `timer` (chrono mesuré, dérivé du timeLimit de la question) à toute la room", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-timer@example.com', 15)
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      await ack(player1, 'player:join', { pin, nickname: 'Alice' })

      const timerPromise = waitFor<{ timeLimit?: number; startedAt?: number }>(player1, 'timer')
      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      const timer = await timerPromise
      expect(timer.timeLimit).toBe(15)
      expect(typeof timer.startedAt).toBe('number')
      // Anti-triche : le timer ne porte évidemment aucun contenu de réponse.
      expect(JSON.stringify(timer)).not.toContain('correct')
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("screen:progress : le grand écran reçoit le compteur de réponses (answered/total), sans jamais la bonne réponse", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-progress@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      const player2 = await connectClient(url)
      clients.push(player1, player2)
      await ack(player1, 'player:join', { pin, nickname: 'Alice' })
      await ack(player2, 'player:join', { pin, nickname: 'Bob' })

      const tokenAck = await ack<{ displayToken?: string }>(hostSocket, 'host:createScreenToken', {})
      const screen = await connectClient(url)
      clients.push(screen)
      await ack(screen, 'screen:join', { displayToken: tokenAck.displayToken })

      await ack(hostSocket, 'host:start', {})

      const progressPromise = waitFor<{ answered?: number; total?: number }>(screen, 'screen:progress')
      const answerAck = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answerAck.accepted).toBe(true)

      const progress = await progressPromise
      expect(progress).toEqual({ answered: 1, total: 2 })
      // Anti-triche : le compteur ne contient AUCUN contenu de réponse (ni options, ni `correct`).
      expect(JSON.stringify(progress)).not.toContain('correct')
      expect(JSON.stringify(progress)).not.toContain('Paris')
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:next SANS host:reveal préalable crédite ET persiste quand même la manche en cours (bug important corrigé)", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin, quizId } = await setupHostedSession(app, url, 'gateway-next-noreveal@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      expect(join1.error).toBeUndefined()
      const alicePlayerId = join1.playerId!

      // Bob rejoint aussi mais ne répondra JAMAIS dans ce test : sans un second joueur connecté
      // qui n'a pas répondu, la réponse d'Alice seule déclencherait l'auto-révélation serveur
      // (tous les connectés auraient répondu) AVANT même que host:next ne soit invoqué — ce qui
      // fausserait ce test qui vise spécifiquement le filet de sécurité PROPRE à host:next
      // (révéler en interne avant d'avancer), indépendamment de l'auto-révélation.
      const player2 = await connectClient(url)
      clients.push(player2)
      await ack(player2, 'player:join', { pin, nickname: 'Bob' })

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // Alice répond correctement (index 0 = Paris)...
      const answerAck = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answerAck.accepted).toBe(true)

      // ...mais l'hôte enchaîne DIRECTEMENT host:next, SANS émettre host:reveal au préalable —
      // exactement le scénario du bug (phase encore 'question' au moment de host:next). Avec le
      // fix, host:next révèle en interne AVANT d'avancer : question:reveal est donc quand même
      // émis, suivi (quiz mono-question) du podium avec le score d'Alice crédité.
      const revealPromise = waitFor<{ correct: unknown }>(player1, 'question:reveal')
      const podiumPromise = waitFor<{ top: Array<{ playerId: string; score: number }> }>(player1, 'podium')
      const nextAck = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck.error).toBeUndefined()
      expect(nextAck.phase).toBe('podium')

      const reveal = await revealPromise
      expect(reveal.correct).toBeDefined()

      const podium = await podiumPromise
      const aliceTop = podium.top.find((r) => r.playerId === alicePlayerId)
      expect(aliceTop).toBeDefined()
      expect(aliceTop!.score).toBeGreaterThan(0)

      // Persistance en base : un answer_record existe bien pour Alice (correct, points > 0) et
      // son total_score reflète ces points — la manche n'a pas été silencieusement perdue.
      const [dbSession] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.quizId, quizId))
      expect(dbSession).toBeDefined()
      const dbPlayers = await ctx.db.select().from(schema.sessionPlayer).where(eq(schema.sessionPlayer.sessionId, dbSession.id))
      const aliceDb = dbPlayers.find((p) => p.nickname === 'Alice')
      expect(aliceDb).toBeDefined()
      expect(aliceDb!.totalScore).toBeGreaterThan(0)
      expect(aliceDb!.totalScore).toBe(aliceTop!.score)

      const dbAnswers = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
      expect(dbAnswers).toHaveLength(1)
      expect(dbAnswers[0].playerId).toBe(aliceDb!.id)
      expect(dbAnswers[0].isCorrect).toBe(true)
      expect(dbAnswers[0].points).toBeGreaterThan(0)
      expect(dbAnswers[0].points).toBe(aliceDb!.totalScore)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:reconnect : un NOUVEAU socket authentifié comme le même hôte reprend la main (host:start/host:reveal) ; un autre utilisateur authentifié est refusé", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'gateway-host-reconnect@example.com')
      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz reconnexion hôte' },
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
          readingTime: 0,
          payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
        },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(questionRes.statusCode).toBe(201)

      const hostSocketA = await connectClient(url, { cookie })
      clients.push(hostSocketA)
      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
        hostSocketA,
        'host:create',
        { quizId: quiz.id },
      )
      expect(created.error).toBeUndefined()
      const { sessionId, pin } = created as { sessionId: string; pin: string }

      // Un joueur rejoint AVANT que l'hôte ne disparaisse — pour vérifier que le socket
      // reconnecté reçoit bien le snapshot lobby (Task 8), pas seulement l'ack.
      const player1 = await connectClient(url)
      clients.push(player1)
      const joinRes = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      expect(joinRes.error).toBeUndefined()

      // L'hôte A disparaît (ex. rechargement de page) — l'ancien socket ne peut plus rien piloter.
      hostSocketA.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Un NOUVEAU socket, authentifié avec le MÊME utilisateur (même cookie), reprend la main.
      // Écouteur posé AVANT l'appel : le snapshot est émis de façon synchrone dans le handler
      // `host:reconnect`, donc AVANT que l'ack ne résolve côté client.
      const hostSocketB = await connectClient(url, { cookie })
      clients.push(hostSocketB)
      const lobbySnapshotPromise = waitFor<{ players: Array<{ id: string; nickname: string }> }>(hostSocketB, 'lobby:update')
      const reconnectAck = await ack<{ sessionId?: string; pin?: string; phase?: string; error?: string }>(
        hostSocketB,
        'host:reconnect',
        { sessionId },
      )
      expect(reconnectAck.error).toBeUndefined()
      expect(reconnectAck.sessionId).toBe(sessionId)
      expect(reconnectAck.phase).toBe('lobby')

      // Snapshot phase 'lobby' (Task 8) : le socket reconnecté reçoit la liste des joueurs
      // ACTUELS — pas seulement l'ack {sessionId,pin,phase} — sans attendre un futur
      // `player:join`/`host:start`, uniquement à LUI (jamais rediffusé à toute la room).
      const lobbySnapshot = await lobbySnapshotPromise
      expect(lobbySnapshot.players).toHaveLength(1)
      expect(lobbySnapshot.players[0]!.nickname).toBe('Alice')

      // hostSocketB peut désormais piloter la partie exactement comme l'aurait fait hostSocketA.
      const startAck = await ack<{ error?: string }>(hostSocketB, 'host:start', {})
      expect(startAck.error).toBeUndefined()
      const revealAck = await ack<{ error?: string }>(hostSocketB, 'host:reveal', {})
      expect(revealAck.error).toBeUndefined()

      // Un AUTRE utilisateur authentifié (pas l'hôte de CETTE session) tente host:reconnect → refusé.
      const otherCookie = await signUp(app, 'gateway-host-reconnect-intruder@example.com')
      const intruder = await connectClient(url, { cookie: otherCookie })
      clients.push(intruder)
      const intruderAck = await ack<{ error?: string; sessionId?: string }>(intruder, 'host:reconnect', { sessionId })
      expect(intruderAck.error).toBeTruthy()
      expect(intruderAck.sessionId).toBeUndefined()
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:create : l'id de session renvoyé par l'ack EST l'id `game_session` PERSISTÉ (Task 2, unification moteur↔DB — plus deux espaces d'id distincts)", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const cookie = await signUp(app, 'gateway-host-create-unified-id@example.com')
      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Quiz id unifié' },
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
          readingTime: 0,
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
      const { sessionId } = created as { sessionId: string; pin: string }

      // Une SEULE ligne `game_session` est créée pour ce quiz, et son id est EXACTEMENT celui
      // renvoyé par l'ack — plus de `dbSessionIdToEngineId` : un unique id sert à la fois de clé
      // moteur (mémoire) et de clé `game_session.id` (DB, colonne `engine_state` du store
      // persistant Task 3).
      const dbSessions = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.quizId, quiz.id))
      expect(dbSessions).toHaveLength(1)
      expect(dbSessions[0]!.id).toBe(sessionId)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("screen:reconnect : un écran déconnecté puis reconnecté rejoint à nouveau et continue de recevoir les diffusions", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin, sessionId } = await setupHostedSession(app, url, 'gateway-screen-reconnect@example.com')
      clients.push(hostSocket)

      const tokenAck = await ack<{ displayToken?: string }>(hostSocket, 'host:createScreenToken', {})
      const displayToken = tokenAck.displayToken!

      const screen = await connectClient(url)
      clients.push(screen)
      const joinRes = await ack<{ ok?: boolean; error?: string }>(screen, 'screen:join', { displayToken })
      expect(joinRes.error).toBeUndefined()
      expect(joinRes.ok).toBe(true)

      // Coupure réseau : l'écran se déconnecte.
      screen.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Reconnexion via un NOUVEAU socket, muni du MÊME displayToken (déjà connu du client, ex.
      // localStorage) — sans ce chemin, le token déjà consommé par screen:join rendrait le
      // projecteur définitivement inaccessible après le moindre blip réseau.
      const screen2 = await connectClient(url)
      clients.push(screen2)
      const reconnectRes = await ack<{ ok?: boolean; error?: string }>(
        screen2,
        'screen:reconnect',
        { sessionId, displayToken },
      )
      expect(reconnectRes.error).toBeUndefined()
      expect(reconnectRes.ok).toBe(true)

      // Le nouvel écran continue bien de recevoir les diffusions de la room.
      const lobbyPromise = waitFor<{ players: Array<{ id: string }> }>(screen2, 'lobby:update')
      const player1 = await connectClient(url)
      clients.push(player1)
      await ack(player1, 'player:join', { pin, nickname: 'Zoé' })
      const lobby = await lobbyPromise
      expect(lobby.players).toHaveLength(1)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("player:join et screen:join EN PLEINE QUESTION (latecomer) reçoivent question:show (sans bonne réponse) + timer", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-latecomer@example.com', 25)
      clients.push(hostSocket)

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // Un joueur rejoint APRÈS le lancement de la question (PIN partagé en cours de manche).
      const latePlayer = await connectClient(url)
      clients.push(latePlayer)
      const showPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(latePlayer, 'question:show')
      const timerPromise = waitFor<{ timeLimit?: number }>(latePlayer, 'timer')
      const joinAck = await ack<{ playerId?: string; error?: string }>(latePlayer, 'player:join', { pin, nickname: 'Latecomer' })
      expect(joinAck.error).toBeUndefined()

      const show = await showPromise
      for (const option of show.payload.options) expect(option).not.toHaveProperty('correct')
      expect(JSON.stringify(show)).not.toContain('correct') // anti-triche
      const timer = await timerPromise
      expect(timer.timeLimit).toBe(25)

      // Un grand écran qui rejoint APRÈS le lancement reçoit aussi la question en cours.
      const tokenAck = await ack<{ displayToken?: string }>(hostSocket, 'host:createScreenToken', {})
      const screen = await connectClient(url)
      clients.push(screen)
      const screenShowPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(screen, 'question:show')
      const screenJoinAck = await ack<{ ok?: boolean; error?: string }>(screen, 'screen:join', { displayToken: tokenAck.displayToken })
      expect(screenJoinAck.error).toBeUndefined()
      const screenShow = await screenShowPromise
      expect(JSON.stringify(screenShow)).not.toContain('correct') // anti-triche
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:skip : avance SANS jamais émettre question:reveal, mais crédite et persiste les réponses déjà données (vrai skip, pas un alias de reveal)", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin, quizId } = await setupHostedSession(app, url, 'gateway-skip@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      expect(join1.error).toBeUndefined()

      // Bob rejoint aussi mais ne répondra JAMAIS dans ce test : sans un second joueur connecté
      // qui n'a pas répondu, la réponse d'Alice seule déclencherait l'auto-révélation serveur
      // (tous les connectés auraient répondu) AVANT même que host:skip ne soit invoqué — ce qui
      // fausserait ce test qui vise spécifiquement le comportement de host:skip sur une manche
      // PAS ENCORE révélée.
      const player2 = await connectClient(url)
      clients.push(player2)
      await ack(player2, 'player:join', { pin, nickname: 'Bob' })

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      const answerAck = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answerAck.accepted).toBe(true)

      const noRevealLeak = raceNoEvent(player1, 'question:reveal', 500)
      const scoreboardPromise = waitFor<{ ranking: Array<{ playerId: string; score: number }> }>(player1, 'scoreboard')
      const skipAck = await ack<{ ok?: boolean; error?: string }>(hostSocket, 'host:skip', {})
      expect(skipAck.error).toBeUndefined()
      expect(await noRevealLeak).toBe(true) // le timeout a gagné : aucune fuite de question:reveal

      const scoreboard = await scoreboardPromise
      const alice = scoreboard.ranking.find((r) => r.playerId === join1.playerId)
      expect(alice).toBeDefined()
      expect(alice!.score).toBeGreaterThan(0) // créditée malgré le skip (elle avait répondu)

      // La partie avance bien (quiz mono-question → podium via host:next, sans host:reveal
      // préalable requis puisque la manche a déjà été révélée/créditée par host:skip).
      const podiumPromise = waitFor<{ top: Array<{ playerId: string; score: number }> }>(player1, 'podium')
      const nextAck = await ack<{ phase?: string; error?: string }>(hostSocket, 'host:next', {})
      expect(nextAck.error).toBeUndefined()
      const podium = await podiumPromise
      expect(podium.top[0]!.score).toBeGreaterThan(0)

      // Persistance : la réponse d'Alice a bien été enregistrée en base malgré le skip.
      const [dbSession] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.quizId, quizId))
      const dbAnswers = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
      expect(dbAnswers).toHaveLength(1)
      expect(dbAnswers[0].isCorrect).toBe(true)
      expect(dbAnswers[0].points).toBeGreaterThan(0)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:skip émis depuis le lobby (avant host:start) est refusé, sans fuite de scoreboard", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-skip-lobby@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      await ack(player1, 'player:join', { pin, nickname: 'Alice' })

      const noScoreboardLeak = raceNoEvent(player1, 'scoreboard', 500)
      const skipAck = await ack<{ error?: string }>(hostSocket, 'host:skip', {})
      expect(skipAck.error).toBeTruthy()
      expect(await noScoreboardLeak).toBe(true)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 15_000)

  it("player:reconnect inclut `alreadyAnswered` : true si le joueur avait déjà répondu à la question en cours, false sinon", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-already-answered@example.com', 30)
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      expect(join1.error).toBeUndefined()

      const player2 = await connectClient(url)
      clients.push(player2)
      const join2 = await ack<{ playerId?: string; joinToken?: string; error?: string }>(player2, 'player:join', { pin, nickname: 'Bob' })
      expect(join2.error).toBeUndefined()

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // Alice répond, Bob ne répond pas.
      const answerAck = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answerAck.accepted).toBe(true)

      player1.disconnect()
      player2.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 150))

      const player1b = await connectClient(url)
      clients.push(player1b)
      const reconnect1 = await ack<{ alreadyAnswered?: boolean; error?: string }>(
        player1b,
        'player:reconnect',
        { pin, joinToken: join1.joinToken },
      )
      expect(reconnect1.error).toBeUndefined()
      expect(reconnect1.alreadyAnswered).toBe(true)

      const player2b = await connectClient(url)
      clients.push(player2b)
      const reconnect2 = await ack<{ alreadyAnswered?: boolean; error?: string }>(
        player2b,
        'player:reconnect',
        { pin, joinToken: join2.joinToken },
      )
      expect(reconnect2.error).toBeUndefined()
      expect(reconnect2.alreadyAnswered).toBe(false)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("host:reveal émis depuis le lobby (avant host:start) est refusé, sans fuite de question:reveal/scoreboard", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-reveal-lobby@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      clients.push(player1)
      const join1 = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      expect(join1.error).toBeUndefined()

      // Toujours en lobby (host:start n'a jamais été émis) : host:reveal doit être refusé, sans
      // émettre le moindre `question:reveal` (qui contiendrait `correct: undefined`) ni `scoreboard`.
      const noRevealLeak = raceNoEvent(player1, 'question:reveal', 500)
      const noScoreboardLeak = raceNoEvent(player1, 'scoreboard', 500)
      const revealAck = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
      expect(revealAck.error).toBeTruthy()
      expect(await noRevealLeak).toBe(true) // le timeout a gagné : aucune fuite
      expect(await noScoreboardLeak).toBe(true)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 15_000)

  it("auto-révélation serveur : quand TOUS les joueurs connectés ont répondu, question:reveal + scoreboard sont émis SANS host:reveal/host:skip", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-autoreveal-happy@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      const player2 = await connectClient(url)
      clients.push(player1, player2)
      const join1 = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
      expect(join1.error).toBeUndefined()
      const join2 = await ack<{ playerId?: string; error?: string }>(player2, 'player:join', { pin, nickname: 'Bob' })
      expect(join2.error).toBeUndefined()

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // hostSocket observe la room (jamais host:reveal/host:skip émis dans ce test — la
      // révélation doit provenir UNIQUEMENT du serveur, déclenchée par les 2 réponses ci-dessous).
      const revealPromise = waitFor<{ correct: unknown; distribution: Record<string, number> }>(hostSocket, 'question:reveal')
      const scoreboardPromise = waitFor<{ ranking: Array<{ playerId: string; score: number }> }>(hostSocket, 'scoreboard')

      const answer1 = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answer1.accepted).toBe(true)
      const answer2 = await ack<{ accepted?: boolean }>(player2, 'player:answer', { answer: { optionIndex: 1 } })
      expect(answer2.accepted).toBe(true)

      const reveal = await revealPromise
      expect(reveal.correct).toBeDefined()
      expect(JSON.stringify(reveal.correct)).toContain('Paris')

      const scoreboard = await scoreboardPromise
      expect(scoreboard.ranking).toHaveLength(2)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("auto-révélation serveur : ne se déclenche PAS tant qu'un joueur connecté n'a pas répondu, puis se déclenche dès qu'il répond", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-autoreveal-early@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      const player2 = await connectClient(url)
      clients.push(player1, player2)
      await ack(player1, 'player:join', { pin, nickname: 'Alice' })
      await ack(player2, 'player:join', { pin, nickname: 'Bob' })

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      // Seule Alice répond : Bob (connecté) n'a pas encore répondu → pas de révélation.
      const noRevealLeak = raceNoEvent(hostSocket, 'question:reveal', 500)
      const answer1 = await ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } })
      expect(answer1.accepted).toBe(true)
      expect(await noRevealLeak).toBe(true) // le timeout a gagné : aucune révélation prématurée

      // Bob répond à son tour : maintenant TOUS les connectés ont répondu → révélation.
      const revealPromise = waitFor<{ correct: unknown }>(hostSocket, 'question:reveal')
      const answer2 = await ack<{ accepted?: boolean }>(player2, 'player:answer', { answer: { optionIndex: 1 } })
      expect(answer2.accepted).toBe(true)
      const reveal = await revealPromise
      expect(reveal.correct).toBeDefined()
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  it("auto-révélation serveur : un seul question:reveal par manche (idempotent), même si les 2 dernières réponses arrivent quasi simultanément", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const { hostSocket, pin } = await setupHostedSession(app, url, 'gateway-autoreveal-idem@example.com')
      clients.push(hostSocket)

      const player1 = await connectClient(url)
      const player2 = await connectClient(url)
      clients.push(player1, player2)
      await ack(player1, 'player:join', { pin, nickname: 'Alice' })
      await ack(player2, 'player:join', { pin, nickname: 'Bob' })

      const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(startAck.error).toBeUndefined()

      const receivedReveals: Array<{ correct: unknown }> = []
      hostSocket.on('question:reveal', (payload: { correct: unknown }) => receivedReveals.push(payload))

      // Les 2 réponses partent quasi simultanément (pas d'attente de l'ack entre les deux) —
      // exactement le scénario de course que la garde `autoRevealedRounds` doit couvrir.
      const [answer1, answer2] = await Promise.all([
        ack<{ accepted?: boolean }>(player1, 'player:answer', { answer: { optionIndex: 0 } }),
        ack<{ accepted?: boolean }>(player2, 'player:answer', { answer: { optionIndex: 1 } }),
      ])
      expect(answer1.accepted).toBe(true)
      expect(answer2.accepted).toBe(true)

      // Laisse le temps à un éventuel second `question:reveal` en double d'arriver s'il existait
      // (idempotence anti-race — voir `meta.autoRevealedRounds`).
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(receivedReveals).toHaveLength(1)
      expect(receivedReveals[0]!.correct).toBeDefined()
      expect(JSON.stringify(receivedReveals[0]!.correct)).toContain('Paris')
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  }, 20_000)

  // Task 3 — phase 'reading' (temps de lecture) : planification serveur (setTimeout) de la
  // révélation automatique. Fake timers (`vi.useFakeTimers`) pour ne jamais attendre de vraies
  // secondes en test — voir le commentaire de `raceNoEvent` et les notes de `SessionMeta.readingTimeout`
  // côté passerelle. Le champ `toFake` est restreint à `setTimeout`/`clearTimeout` (les seuls
  // timers que la passerelle utilise pour cette fonctionnalité) pour ne pas perturber les
  // mécanismes internes de Socket.IO (ping/heartbeat, etc.) qui tournent dans le MÊME process.
  describe("phase 'reading' (temps de lecture) — planification serveur", () => {
    it("host:start d'une question avec readingTime>0 émet question:reading (sans options) puis, à échéance, question:show + timer", async () => {
      const { app, url } = await buildApp()
      const clients: ClientSocket[] = []
      try {
        const { hostSocket, pin } = await setupHostedSessionWithReading(app, url, 'gateway-reading-flow@example.com', 6, 20)
        clients.push(hostSocket)

        const player1 = await connectClient(url)
        clients.push(player1)
        await ack(player1, 'player:join', { pin, nickname: 'Alice' })

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
          const readingPromise = waitFor<{ prompt?: string; index?: number; total?: number; readingTime?: number; startedAt?: number }>(
            player1,
            'question:reading',
          )
          const startAckPromise = ack<{ prompt?: string; readingTime?: number; error?: string }>(hostSocket, 'host:start', {})

          const reading = await readingPromise
          expect(reading.readingTime).toBe(6)
          expect(reading.prompt).toBeTruthy()
          // Anti-triche : la projection « lecture » ne porte JAMAIS les options/la bonne réponse.
          expect(reading).not.toHaveProperty('payload')
          expect(reading).not.toHaveProperty('options')
          expect(JSON.stringify(reading)).not.toContain('Paris')
          expect(JSON.stringify(reading)).not.toContain('correct')

          const startAck = await startAckPromise
          expect(startAck.error).toBeUndefined()
          expect(startAck.readingTime).toBe(6) // l'ack de host:start reflète aussi la readingView

          // Avant échéance : pas encore de question:show.
          const noShowYet = raceNoEvent(player1, 'question:show', 500)
          await vi.advanceTimersByTimeAsync(500)
          expect(await noShowYet).toBe(true)

          // À l'échéance (6 s au total) : question:show (sans bonne réponse) + timer.
          const showPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player1, 'question:show')
          const timerPromise = waitFor<{ timeLimit?: number; startedAt?: number }>(player1, 'timer')
          await vi.advanceTimersByTimeAsync(5_600)

          const show = await showPromise
          expect(show.payload).toBeDefined()
          for (const option of show.payload.options) expect(option).not.toHaveProperty('correct')
          expect(JSON.stringify(show)).not.toContain('correct')

          const timer = await timerPromise
          expect(timer.timeLimit).toBe(20)
          expect(typeof timer.startedAt).toBe('number')
        } finally {
          vi.useRealTimers()
        }
      } finally {
        for (const c of clients) c.disconnect()
        await app.close()
      }
    }, 20_000)

    it("une révélation manuelle anticipée (host:reveal) pendant la lecture annule le minuteur planifié (pas de question:show fantôme après échéance)", async () => {
      const { app, url } = await buildApp()
      const clients: ClientSocket[] = []
      try {
        const { hostSocket, pin } = await setupHostedSessionWithReading(app, url, 'gateway-reading-cancel@example.com', 6)
        clients.push(hostSocket)

        const player1 = await connectClient(url)
        clients.push(player1)
        await ack(player1, 'player:join', { pin, nickname: 'Alice' })

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
          const readingPromise = waitFor(player1, 'question:reading')
          const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
          expect(startAck.error).toBeUndefined()
          await readingPromise

          // Révélation manuelle anticipée, encore en pleine lecture (bien avant les 6 s).
          const revealAck = await ack<{ error?: string }>(hostSocket, 'host:reveal', {})
          expect(revealAck.error).toBeUndefined()

          const showsAfterReveal: unknown[] = []
          player1.on('question:show', (payload: unknown) => showsAfterReveal.push(payload))

          // Avance largement au-delà de l'échéance de lecture (6 s) : si le minuteur n'avait pas
          // été annulé, un `question:show` fantôme (double révélation) arriverait ici.
          await vi.advanceTimersByTimeAsync(10_000)

          expect(showsAfterReveal).toHaveLength(0)
        } finally {
          vi.useRealTimers()
        }
      } finally {
        for (const c of clients) c.disconnect()
        await app.close()
      }
    }, 20_000)

    it("emitReconnectSnapshot en phase 'reading' émet question:reading avec le temps de lecture restant (jamais fabriqué côté client)", async () => {
      const { app, url } = await buildApp()
      const clients: ClientSocket[] = []
      try {
        const { hostSocket, pin, sessionId, cookie } = await setupHostedSessionWithReading(
          app,
          url,
          'gateway-reading-reconnect@example.com',
          6,
        )
        clients.push(hostSocket)

        const player1 = await connectClient(url)
        clients.push(player1)
        await ack(player1, 'player:join', { pin, nickname: 'Alice' })

        // Le socket de reprise est connecté AVANT d'activer les fake timers : Socket.IO
        // (client ET serveur) s'appuie en interne sur de VRAIS timers pour son propre
        // handshake — établir une connexion réseau pendant que `setTimeout` est mocké la ferait
        // rester bloquée indéfiniment (observé : timeout de test). Seule la partie « minuterie
        // de jeu » (readingTimeout planifié par la passerelle) doit être fake-timée ; la
        // connexion réseau elle-même, non.
        const hostSocketB = await connectClient(url, { cookie })
        clients.push(hostSocketB)
        // Laisse le temps à la mise à niveau de transport (polling → websocket, asynchrone en
        // arrière-plan après le premier `connect`) de se terminer AVANT d'activer les fake
        // timers — sinon sa poursuite (qui dépend de VRAIS setTimeout internes programmés APRÈS
        // ce point) resterait bloquée indéfiniment, sans qu'aucun paquet ultérieur ne puisse
        // plus jamais être délivré sur ce socket (observé : `host:reconnect` jamais reçu côté
        // serveur, alors que `hostSocketB.connected` reste pourtant `true`).
        await new Promise((resolve) => setTimeout(resolve, 200))

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
          const readingPromise = waitFor(player1, 'question:reading')
          const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
          expect(startAck.error).toBeUndefined()
          await readingPromise

          // Avance un peu (mais reste bien EN DEÇÀ de l'échéance de 6 s) avant la reprise.
          await vi.advanceTimersByTimeAsync(2_000)

          // Reprise hôte (déjà connecté ci-dessus) EN PLEINE lecture — symétrique de
          // host:reconnect en phase 'question' (voir les tests Task 5/8 plus haut).
          const reconnectReadingPromise = waitFor<{ prompt?: string; readingTime?: number; startedAt?: number }>(
            hostSocketB,
            'question:reading',
          )
          const reconnectAck = await ack<{ sessionId?: string; phase?: string; error?: string }>(
            hostSocketB,
            'host:reconnect',
            { sessionId },
          )
          expect(reconnectAck.error).toBeUndefined()
          expect(reconnectAck.phase).toBe('reading')

          const reconnectReading = await reconnectReadingPromise
          expect(reconnectReading.readingTime).toBe(6)
          expect(typeof reconnectReading.startedAt).toBe('number')
          // Anti-triche : toujours aucune option/bonne réponse dans ce snapshot.
          expect(JSON.stringify(reconnectReading)).not.toContain('correct')
          expect(JSON.stringify(reconnectReading)).not.toContain('Paris')

          // Le minuteur serveur continue de courir indépendamment de la reconnexion : à
          // échéance, la room reçoit toujours question:show + timer.
          const showPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(player1, 'question:show')
          await vi.advanceTimersByTimeAsync(4_500) // 2000 déjà écoulés + 4500 = 6500 > 6000
          const show = await showPromise
          expect(show.payload).toBeDefined()
        } finally {
          vi.useRealTimers()
        }
      } finally {
        for (const c of clients) c.disconnect()
        await app.close()
      }
    }, 20_000)
  })

  // Task 4 — réhydratation au boot : un `PersistentSessionStore` (Task 3) écrit l'état moteur en
  // base à chaque mutation. Ici on simule un VRAI redémarrage serveur : deux instances
  // successives de l'app, chacune avec son PROPRE `PersistentSessionStore` (cache mémoire froid)
  // mais la MÊME base Postgres (`ctx.db`) — la seconde ne partage RIEN en mémoire avec la
  // première, exactement comme un process qui reprendrait après un crash/déploiement.
  describe('Task 4 — réhydratation au boot (redémarrage serveur)', () => {
    it("survit à un redémarrage (phase 'question') : host:reconnect sur la NOUVELLE instance retrouve la même session, la bonne phase, et rejoue joueurs + question au socket", async () => {
      const store1 = new PersistentSessionStore(ctx.db)
      const { app: app1, url: url1 } = await buildApp(store1)
      const clients1: ClientSocket[] = []
      let sessionId = ''
      let pin = ''
      let cookie = ''
      let timerBeforeRestart = 0
      try {
        cookie = await signUp(app1, 'gateway-restart-question@example.com')
        const quizRes = await app1.inject({
          method: 'POST',
          url: '/api/quizzes',
          payload: { title: 'Quiz redémarrage' },
          headers: { 'content-type': 'application/json', cookie },
        })
        expect(quizRes.statusCode).toBe(201)
        const quiz = quizRes.json() as { id: string }

        const questionRes = await app1.inject({
          method: 'POST',
          url: `/api/quizzes/${quiz.id}/questions`,
          payload: {
            type: 'mcq',
            prompt: 'Capitale de la France ?',
            timeLimit: 20,
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
        expect(questionRes.statusCode).toBe(201)

        const hostSocket = await connectClient(url1, { cookie })
        clients1.push(hostSocket)
        const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(
          hostSocket,
          'host:create',
          { quizId: quiz.id },
        )
        expect(created.error).toBeUndefined()
        sessionId = created.sessionId!
        pin = created.pin!

        const player1 = await connectClient(url1)
        clients1.push(player1)
        const join1 = await ack<{ playerId?: string; error?: string }>(player1, 'player:join', { pin, nickname: 'Alice' })
        expect(join1.error).toBeUndefined()

        const timerPromise = waitFor<{ startedAt?: number }>(player1, 'timer')
        const startAck = await ack<{ error?: string }>(hostSocket, 'host:start', {})
        expect(startAck.error).toBeUndefined()
        const timer = await timerPromise
        timerBeforeRestart = timer.startedAt!
        expect(typeof timerBeforeRestart).toBe('number')

        // Laisse s'écouler un peu de temps réel AVANT le "redémarrage" — sert à prouver plus bas
        // que le chrono repart bien à neuf (nouveau `startedAt`, strictement postérieur), et pas
        // seulement recopié tel quel depuis l'état persisté.
        await new Promise((resolve) => setTimeout(resolve, 300))
      } finally {
        for (const c of clients1) c.disconnect()
        await app1.close()
      }

      // "Redémarrage" : nouveau store persistant (cache mémoire froid), même base Postgres.
      const store2 = new PersistentSessionStore(ctx.db)
      const { app: app2, url: url2 } = await buildApp(store2)
      const clients2: ClientSocket[] = []
      try {
        const hostSocketB = await connectClient(url2, { cookie })
        clients2.push(hostSocketB)

        // Posés AVANT l'appel : `emitReconnectSnapshot` les émet de façon synchrone dans le
        // handler `host:reconnect`, avant que son ack ne résolve côté client.
        const lobbyPromise = waitFor<{ players: Array<{ id: string; nickname: string }> }>(hostSocketB, 'lobby:update')
        const showPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(hostSocketB, 'question:show')
        const timerAfterRestartPromise = waitFor<{ timeLimit?: number; startedAt?: number }>(hostSocketB, 'timer')

        const reconnectAck = await ack<{ sessionId?: string; pin?: string; phase?: string; error?: string }>(
          hostSocketB,
          'host:reconnect',
          { sessionId },
        )
        expect(reconnectAck.error).toBeUndefined()
        // Même id partout (Task 2, unification moteur↔DB) : la NOUVELLE instance retrouve la
        // session sous EXACTEMENT le même id, reconstruit depuis `game_session`/`engine_state`.
        expect(reconnectAck.sessionId).toBe(sessionId)
        expect(reconnectAck.phase).toBe('question')

        const lobby = await lobbyPromise
        expect(lobby.players).toHaveLength(1)
        expect(lobby.players[0]!.nickname).toBe('Alice')

        const show = await showPromise
        expect(show.payload).toBeDefined()
        for (const option of show.payload.options) expect(option).not.toHaveProperty('correct')
        expect(JSON.stringify(show)).not.toContain('correct') // anti-triche, même garde qu'ailleurs

        const timerAfterRestart = await timerAfterRestartPromise
        expect(timerAfterRestart.timeLimit).toBe(20)
        expect(typeof timerAfterRestart.startedAt).toBe('number')
        // Le chrono est bien ré-ancré À NEUF (décision produit : "chrono qui repart à neuf") —
        // le nouveau `startedAt` est strictement postérieur à celui d'avant redémarrage, jamais
        // recopié tel quel depuis l'état persisté (qui daterait d'avant le délai réel ci-dessus).
        expect(timerAfterRestart.startedAt!).toBeGreaterThan(timerBeforeRestart)
      } finally {
        for (const c of clients2) c.disconnect()
        await app2.close()
      }
    }, 30_000)

    it('P1-8 cicatrisation : une manche créditée dont les answer_record ont été perdus (fenêtre de crash) est ré-persistée au redémarrage', async () => {
      const store1 = new PersistentSessionStore(ctx.db)
      const { app: app1, url: url1 } = await buildApp(store1)
      const clients1: ClientSocket[] = []
      let sessionId = ''
      let cookie = ''
      let quizId = ''
      try {
        cookie = await signUp(app1, 'p1-8-heal@example.com')
        const quizRes = await app1.inject({
          method: 'POST', url: '/api/quizzes',
          payload: { title: 'Quiz cicatrisation' },
          headers: { 'content-type': 'application/json', cookie },
        })
        quizId = (quizRes.json() as { id: string }).id
        await app1.inject({
          method: 'POST', url: `/api/quizzes/${quizId}/questions`,
          payload: {
            type: 'mcq', prompt: 'Capitale ?', timeLimit: 20, readingTime: 0,
            payload: { options: [{ label: 'Paris', correct: true }, { label: 'Lyon', correct: false }] },
          },
          headers: { 'content-type': 'application/json', cookie },
        })

        const hostSocket = await connectClient(url1, { cookie })
        clients1.push(hostSocket)
        const created = await ack<{ sessionId?: string; pin?: string }>(hostSocket, 'host:create', { quizId })
        sessionId = created.sessionId!

        const player1 = await connectClient(url1)
        clients1.push(player1)
        await ack(player1, 'player:join', { pin: created.pin, nickname: 'Alice' })
        await ack(hostSocket, 'host:start', {})
        await ack(player1, 'player:answer', { answer: { optionIndex: 0 } })
        // host:reveal crédite (credited[0]=true, persisté dans engine_state) ET écrit answer_record.
        await ack(hostSocket, 'host:reveal', {})

        const [dbSession] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
        const before = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
        expect(before).toHaveLength(1)

        // SIMULATION de la fenêtre de crash : les answer_record n'ont jamais atteint la base
        // (crash pile entre engine.reveal() et persistRound) — mais engine_state a bien credited[0].
        await ctx.db.delete(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
        const gap = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
        expect(gap).toHaveLength(0)
      } finally {
        for (const c of clients1) c.disconnect()
        await app1.close()
      }

      // Redémarrage : la réhydratation (registerGameGateway) doit CICATRISER la manche créditée
      // en ré-écrivant ses answer_record depuis engine_state, idempotemment.
      const store2 = new PersistentSessionStore(ctx.db)
      const { app: app2 } = await buildApp(store2)
      try {
        const [dbSession] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
        const healed = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.sessionId, dbSession.id))
        expect(healed).toHaveLength(1)
        expect(healed[0].isCorrect).toBe(true)
        expect(healed[0].points).toBeGreaterThan(0)
      } finally {
        await app2.close()
      }
    }, 30_000)

    it("survit à un redémarrage (phase 'reading') : ré-ancre readingStartedAt à neuf ET reprogramme la révélation automatique pour le readingTime COMPLET (pas le reliquat)", async () => {
      const store1 = new PersistentSessionStore(ctx.db)
      const { app: app1, url: url1 } = await buildApp(store1)
      const clients1: ClientSocket[] = []
      let sessionId = ''
      let cookie = ''
      let readingStartedAtBeforeRestart = 0
      try {
        const setup = await setupHostedSessionWithReading(app1, url1, 'gateway-restart-reading@example.com', 2, 20)
        clients1.push(setup.hostSocket)
        sessionId = setup.sessionId
        cookie = setup.cookie

        const player1 = await connectClient(url1)
        clients1.push(player1)
        const join1 = await ack<{ error?: string }>(player1, 'player:join', { pin: setup.pin, nickname: 'Alice' })
        expect(join1.error).toBeUndefined()

        const readingPromise = waitFor<{ startedAt?: number; readingTime?: number }>(player1, 'question:reading')
        const startAck = await ack<{ error?: string }>(setup.hostSocket, 'host:start', {})
        expect(startAck.error).toBeUndefined()
        const reading = await readingPromise
        readingStartedAtBeforeRestart = reading.startedAt!
        expect(reading.readingTime).toBe(2)

        // Redémarrage AVANT échéance des 2 s de lecture (reliquat encore présent) — c'est
        // précisément ce reliquat que le re-ancrage "à neuf" doit ignorer.
        await new Promise((resolve) => setTimeout(resolve, 300))
      } finally {
        for (const c of clients1) c.disconnect()
        await app1.close()
      }

      const store2 = new PersistentSessionStore(ctx.db)
      const { app: app2, url: url2 } = await buildApp(store2)
      const clients2: ClientSocket[] = []
      try {
        const hostSocketB = await connectClient(url2, { cookie })
        clients2.push(hostSocketB)

        const reconnectReadingPromise = waitFor<{ startedAt?: number; readingTime?: number }>(hostSocketB, 'question:reading')
        const showPromise = waitFor<{ payload: { options: Array<Record<string, unknown>> } }>(hostSocketB, 'question:show')

        const reconnectAck = await ack<{ sessionId?: string; phase?: string; error?: string }>(
          hostSocketB,
          'host:reconnect',
          { sessionId },
        )
        expect(reconnectAck.error).toBeUndefined()
        expect(reconnectAck.phase).toBe('reading')

        const reconnectReading = await reconnectReadingPromise
        expect(reconnectReading.readingTime).toBe(2)
        // Ré-ancré à neuf : strictement postérieur au `startedAt` d'avant redémarrage.
        expect(reconnectReading.startedAt!).toBeGreaterThan(readingStartedAtBeforeRestart)

        // La révélation automatique a bien été REPROGRAMMÉE côté nouvelle instance : elle finit
        // par arriver (readingTime complet, 2 s, depuis le redémarrage) — sans reprogrammation,
        // plus aucun minuteur ne courrait jamais pour cette session dans le nouveau process.
        await showPromise
      } finally {
        for (const c of clients2) c.disconnect()
        await app2.close()
      }
    }, 30_000)
  })
})
