import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { eq, sql } from 'drizzle-orm'
import { listDemoDaily, runMigrations, schema, startTestDb } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway, SESSION_FULL_MESSAGE } from './game-gateway.js'
import { PersistentSessionStore } from './persistent-store.js'

// Partie de démonstration côté passerelle : l'hôte invité anime une partie bornée (joueurs, une
// partie à la fois, plafond global, une heure), que le balayage abandonne puis que la purge supprime.

const HOUR = 3_600_000
const JSON_HEADERS = { 'content-type': 'application/json' }

let ctx: Awaited<ReturnType<typeof startTestDb>>

type Booted = {
  app: FastifyInstance
  url: string
  gateway: Awaited<ReturnType<typeof registerGameGateway>>
  store: PersistentSessionStore
  close: () => Promise<void>
}

type Guest = { cookie: string; quizId: string; tenantId: string; userId: string }

/** Sockets ouvertes, par URL de serveur : un serveur ne se ferme qu'une fois ses clients déconnectés. */
const clients = new Map<string, ClientSocket[]>()

async function boot(env: Record<string, string> = {}): Promise<Booted> {
  const config = loadConfig({
    NODE_ENV: 'test',
    TENANCY_MODE: 'multi',
    DEMO_ENABLED: 'true',
    DEMO_MAX_PLAYERS: '2',
    DEMO_MAX_CONCURRENT: '50',
    DEMO_PER_IP_PER_HOUR: '100',
    ...env,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
  })
  await registerAuth(app, auth, { demo: config.demo })
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
  const io = attachRealtime(app, config)
  const store = new PersistentSessionStore(ctx.db)
  const engine = createEngine({ store, now: () => Date.now(), genPin: generatePin, genId: () => crypto.randomUUID() })
  const gateway = await registerGameGateway(io, { engine, systemDb: ctx.db, appDb: ctx.appDb, auth, config, store })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error("pas d'adresse")
  const url = `http://127.0.0.1:${address.port}`
  return {
    app,
    url,
    gateway,
    store,
    close: async () => {
      for (const client of clients.get(url) ?? []) client.disconnect()
      await store.flushAll()
      await app.close()
    },
  }
}

const cookieOf = (setCookie: string | string[] | undefined) =>
  ([] as string[])
    .concat(setCookie ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

/** Un invité créé par la vraie route, avec des questions sans temps de lecture pour jouer vite. */
async function guest(app: FastifyInstance, from?: string): Promise<Guest> {
  const res = await app.inject({ method: 'POST', url: '/api/demo', payload: { from }, headers: JSON_HEADERS })
  expect(res.statusCode).toBe(201)
  const body = res.json() as { quizId: string; tenantId: string }
  const cookie = cookieOf(res.headers['set-cookie'])
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
  await ctx.db.update(schema.question).set({ readingTime: 0 }).where(eq(schema.question.quizId, body.quizId))
  return { cookie, quizId: body.quizId, tenantId: body.tenantId, userId: me.json().user.id }
}

/** Un compte ordinaire avec un quiz d'une question, dans son espace. */
async function ordinaryHost(app: FastifyInstance, email: string): Promise<Guest> {
  const signUp = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Hôte' },
    headers: JSON_HEADERS,
  })
  expect(signUp.statusCode).toBe(200)
  const cookie = cookieOf(signUp.headers['set-cookie'])
  const workspaces = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })
  const tenantId = (workspaces.json() as { workspaces: Array<{ tenantId: string }> }).workspaces[0].tenantId
  const headers = { ...JSON_HEADERS, cookie, 'x-tenant-id': tenantId }
  const quiz = await app.inject({ method: 'POST', url: '/api/quizzes', payload: { title: 'Quiz' }, headers })
  expect(quiz.statusCode).toBe(201)
  const quizId = (quiz.json() as { id: string }).id
  const question = await app.inject({
    method: 'POST',
    url: `/api/quizzes/${quizId}/questions`,
    payload: { type: 'truefalse', prompt: 'Vrai ?', timeLimit: 5, readingTime: 0, payload: { correct: true } },
    headers,
  })
  expect(question.statusCode).toBe(201)
  return { cookie, quizId, tenantId, userId: signUp.json().user.id }
}

function connect(url: string, host?: Pick<Guest, 'cookie' | 'tenantId'>): Promise<ClientSocket> {
  const client = ioClient(url, {
    reconnection: false,
    ...(host ? { extraHeaders: { cookie: host.cookie }, auth: { tenantId: host.tenantId } } : {}),
  })
  clients.set(url, [...(clients.get(url) ?? []), client])
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

type CreateAck = { sessionId?: string; pin?: string; error?: string }
type JoinAck = { playerId?: string; error?: string }

async function create(url: string, host: Guest, quizId = host.quizId): Promise<{ socket: ClientSocket } & CreateAck> {
  const socket = await connect(url, host)
  return { socket, ...(await ack<CreateAck>(socket, 'host:create', { quizId })) }
}

async function join(url: string, pin: string, nickname: string): Promise<JoinAck> {
  return ack<JoinAck>(await connect(url), 'player:join', { pin, nickname })
}

async function startedToday(source: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  return (await listDemoDaily(ctx.db)).find((r) => r.day === today && r.source === source)?.started ?? 0
}

async function statusOf(sessionId: string): Promise<string> {
  const [row] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
  return row.status
}

/** Aucune partie vivante en base : le plafond global repart de zéro. */
async function endAllSessions(): Promise<void> {
  await ctx.db.execute(
    sql`update "game_session" set status = 'abandoned', engine_state = null where status in ('lobby', 'active')`,
  )
}

let main: Booted

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  main = await boot()
}, 120_000)

afterAll(async () => {
  await main?.close()
  await ctx?.stop()
})

describe("partie de démonstration : plafonds de l'hôte invité", () => {
  it("borne une partie d'invité à DEMO_MAX_PLAYERS, pas une partie ordinaire", async () => {
    const demo = await create(main.url, await guest(main.app))
    expect(demo.error).toBeUndefined()
    expect((await join(main.url, demo.pin!, 'Ana')).error).toBeUndefined()
    expect((await join(main.url, demo.pin!, 'Bob')).error).toBeUndefined()
    expect((await join(main.url, demo.pin!, 'Cyd')).error).toBe(SESSION_FULL_MESSAGE)

    const ordinary = await create(main.url, await ordinaryHost(main.app, 'plafond@example.org'))
    expect(ordinary.error).toBeUndefined()
    for (const nickname of ['Ana', 'Bob', 'Cyd']) {
      expect((await join(main.url, ordinary.pin!, nickname)).error).toBeUndefined()
    }
  })

  it('refuse une seconde partie vivante au même invité', async () => {
    const host = await guest(main.app)
    const first = await create(main.url, host)
    expect(first.error).toBeUndefined()

    const second = await create(main.url, host)
    expect(second.error).toBe('Une démonstration est déjà en cours.')
  })

  it("refuse à un invité le quiz d'un autre espace", async () => {
    const other = await ordinaryHost(main.app, 'autre-espace@example.org')
    const refused = await create(main.url, await guest(main.app), other.quizId)
    expect(refused.error).toBe('quiz introuvable')
  })

  it('refuse host:create au-delà de DEMO_MAX_CONCURRENT', async () => {
    await endAllSessions()
    const small = await boot({ DEMO_MAX_CONCURRENT: '1' })
    try {
      // Les deux invités naissent avant qu'une partie existe : seule la passerelle peut refuser.
      const a = await guest(small.app)
      const b = await guest(small.app)
      expect((await create(small.url, a)).error).toBeUndefined()

      const refused = await create(small.url, b)
      expect(refused.error).toBe('La démonstration est très demandée en ce moment.')
      const sessions = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.hostId, b.userId))
      expect(sessions).toHaveLength(0)
    } finally {
      await endAllSessions()
      await small.close()
    }
  })

  it("ne laisse passer qu'une création parmi des lancements simultanés", async () => {
    await endAllSessions()
    const small = await boot({ DEMO_MAX_CONCURRENT: '1' })
    try {
      const guests = [await guest(small.app), await guest(small.app), await guest(small.app)]
      const results = await Promise.all(guests.map((g) => create(small.url, g)))

      expect(results.filter((r) => r.error === undefined)).toHaveLength(1)
      expect(results.filter((r) => r.error === 'La démonstration est très demandée en ce moment.')).toHaveLength(2)
    } finally {
      await endAllSessions()
      await small.close()
    }
  })

  it('garde le plafond de joueurs après un redémarrage', async () => {
    await endAllSessions()
    const before = await boot()
    const demo = await create(before.url, await guest(before.app))
    expect((await join(before.url, demo.pin!, 'Ana')).error).toBeUndefined()
    await before.close()

    const after = await boot()
    try {
      expect((await join(after.url, demo.pin!, 'Bob')).error).toBeUndefined()
      expect((await join(after.url, demo.pin!, 'Cyd')).error).toBe(SESSION_FULL_MESSAGE)
    } finally {
      await endAllSessions()
      await after.close()
    }
  })
})

describe("partie de démonstration : déroulé, durée et purge de l'hôte invité", () => {
  it("laisse l'invité jouer jusqu'au podium puis relancer son quiz", async () => {
    const host = await guest(main.app)
    const demo = await create(main.url, host)
    expect((await join(main.url, demo.pin!, 'Ana')).error).toBeUndefined()

    expect((await ack<{ error?: string }>(demo.socket, 'host:start', {})).error).toBeUndefined()
    let phase = 'question'
    for (let i = 0; i < 5 && phase !== 'podium'; i++) {
      expect((await ack<{ error?: string }>(demo.socket, 'host:reveal', {})).error).toBeUndefined()
      const next = await ack<{ phase?: string; error?: string }>(demo.socket, 'host:next', {})
      expect(next.error).toBeUndefined()
      phase = next.phase ?? phase
    }
    expect(phase).toBe('podium')

    const relaunched = await ack<CreateAck>(demo.socket, 'host:relaunch', { quizId: host.quizId })
    expect(relaunched.error).toBeUndefined()
    expect(relaunched.sessionId).not.toBe(demo.sessionId)
  })

  it('compte une partie démarrée avec au moins un joueur, pas une partie sans joueur', async () => {
    const before = await startedToday('accueil')

    const empty = await create(main.url, await guest(main.app, 'accueil'))
    expect((await ack<{ error?: string }>(empty.socket, 'host:start', {})).error).toBeUndefined()
    expect(await startedToday('accueil')).toBe(before)

    const played = await create(main.url, await guest(main.app, 'accueil'))
    expect((await join(main.url, played.pin!, 'Ana')).error).toBeUndefined()
    expect((await ack<{ error?: string }>(played.socket, 'host:start', {})).error).toBeUndefined()
    expect(await startedToday('accueil')).toBe(before + 1)
  })

  it("abandonne au balayage la partie d'invité de plus d'une heure, et libère son code", async () => {
    const old = await create(main.url, await guest(main.app))
    const recent = await create(main.url, await guest(main.app))
    const ordinary = await create(main.url, await ordinaryHost(main.app, 'longue-partie@example.org'))
    const aged = new Date(Date.now() - HOUR - 60_000)
    await ctx.db.update(schema.gameSession).set({ createdAt: aged }).where(eq(schema.gameSession.id, old.sessionId!))
    await ctx.db
      .update(schema.gameSession)
      .set({ createdAt: aged })
      .where(eq(schema.gameSession.id, ordinary.sessionId!))

    await main.gateway.sweepAbandonedSessions()

    expect(await statusOf(old.sessionId!)).toBe('abandoned')
    expect(await statusOf(recent.sessionId!)).toBe('lobby')
    expect(await statusOf(ordinary.sessionId!)).toBe('lobby')
    expect((await join(main.url, old.pin!, 'Ana')).error).toBeDefined()
    expect((await join(main.url, recent.pin!, 'Ana')).error).toBeUndefined()
  })

  it("supprime à la purge l'invité de plus de 24 heures, pas l'invité du jour", async () => {
    await endAllSessions()
    const old = await guest(main.app)
    const today = await guest(main.app)
    await ctx.db
      .update(schema.user)
      .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
      .where(eq(schema.user.id, old.userId))

    expect(await main.gateway.purgeGuests()).toBeGreaterThanOrEqual(1)

    expect(await ctx.db.select().from(schema.user).where(eq(schema.user.id, old.userId))).toHaveLength(0)
    expect(await ctx.db.select().from(schema.tenant).where(eq(schema.tenant.id, old.tenantId))).toHaveLength(0)
    expect(await ctx.db.select().from(schema.user).where(eq(schema.user.id, today.userId))).toHaveLength(1)
  })
})
