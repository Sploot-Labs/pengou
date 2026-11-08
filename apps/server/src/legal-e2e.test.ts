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
import { registerLegal } from './legal.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'

// Acceptation des CGU : refus de l'inscription sans acceptation (via HTTP), revalidation à chaque
// nouvelle version (403 TERMS_ACCEPTANCE_REQUIRED sur les routes protégées), routes laissées
// ouvertes (session, déconnexion, acceptation), joueurs jamais bloqués et partie en cours jamais
// coupée. Le passage de version est simulé en ramenant `terms_version` de l'hôte à une version
// antérieure, ce qui équivaut pour le serveur à une montée de LEGAL_TERMS_VERSION.

const VERSION = '2026-10-31'
const LEGAL_ENV = {
  LEGAL_TERMS_URL: 'https://pengou.fr/cgu/',
  LEGAL_PRIVACY_URL: 'https://pengou.fr/politique-de-confidentialite/',
  LEGAL_TERMS_VERSION: VERSION,
}
const PASSWORD = 'motdepasse-123456'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

type BuiltApp = { app: FastifyInstance; url: string }

async function buildApp(env: Record<string, string> = LEGAL_ENV): Promise<BuiltApp> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single', ...env })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
    termsVersion: config.legal?.termsVersion,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth, { legal: config.legal })
  registerLegal(app, { db: ctx.db, auth, legal: config.legal })
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
  const io = attachRealtime(app, config)
  const store = new MemorySessionStore()
  const engine = createEngine({ store, now: () => Date.now(), genPin: generatePin, genId: () => crypto.randomUUID() })
  await registerGameGateway(io, { engine, systemDb: ctx.db, appDb: ctx.appDb, auth, config, store })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error("pas d'adresse")
  return { app, url: `http://127.0.0.1:${address.port}` }
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  expect(raw).toBeDefined()
  return Array.isArray(raw) ? raw.map((c: string) => c.split(';')[0]).join('; ') : String(raw).split(';')[0]
}

async function signUp(app: FastifyInstance, email: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name: 'Hôte CGU', ...extra },
    headers: { 'content-type': 'application/json' },
  })
}

/** Inscrit un hôte qui accepte la version courante et renvoie son cookie de session. */
async function signUpAccepting(app: FastifyInstance, email: string): Promise<string> {
  const res = await signUp(app, email, { acceptedTermsVersion: VERSION, ageConfirmed: true })
  expect(res.statusCode).toBe(200)
  return cookieOf(res)
}

async function setTermsVersion(email: string, version: string | null): Promise<void> {
  await ctx.db.update(schema.user).set({ termsVersion: version }).where(eq(schema.user.email, email))
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

describe('configuration publique des CGU', () => {
  it('GET /api/legal expose la version et les liens sans authentification', async () => {
    const { app } = await buildApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/legal' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        termsVersion: VERSION,
        termsUrl: 'https://pengou.fr/cgu/',
        privacyUrl: 'https://pengou.fr/politique-de-confidentialite/',
      })
    } finally {
      await app.close()
    }
  })

  it('GET /api/legal signale une fonction désactivée sans LEGAL_TERMS_VERSION', async () => {
    const { app } = await buildApp({})
    try {
      const res = await app.inject({ method: 'GET', url: '/api/legal' })
      expect(res.json()).toEqual({ termsVersion: null, termsUrl: null, privacyUrl: null })
    } finally {
      await app.close()
    }
  })
})

describe('inscription par HTTP', () => {
  it('refuse sans acceptation, avec le code TERMS_ACCEPTANCE_REQUIRED', async () => {
    const { app } = await buildApp()
    try {
      const res = await signUp(app, 'http-sans-cgu@example.com')
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'TERMS_ACCEPTANCE_REQUIRED' })
      const rows = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'http-sans-cgu@example.com'))
      expect(rows).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('accepte avec la version courante : routes protégées ouvertes, aucune revalidation demandée', async () => {
    const { app } = await buildApp()
    try {
      const cookie = await signUpAccepting(app, 'http-avec-cgu@example.com')
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
      expect(me.statusCode).toBe(200)
      expect(me.json()).toMatchObject({ termsAcceptanceRequired: false })
      const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
      expect(quizzes.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe('revalidation après un changement de version', () => {
  it('les routes protégées répondent 403 TERMS_ACCEPTANCE_REQUIRED', async () => {
    const { app } = await buildApp()
    try {
      const email = 'revalidation@example.com'
      const cookie = await signUpAccepting(app, email)
      await setTermsVersion(email, '2025-01-01')
      for (const [method, url] of [
        ['GET', '/api/quizzes'],
        ['POST', '/api/quizzes'],
        ['GET', '/api/workspaces'],
        ['GET', '/api/sessions'],
      ] as const) {
        const res = await app.inject({
          method,
          url,
          headers: { cookie, 'content-type': 'application/json' },
          payload: method === 'POST' ? { title: 'Bloqué' } : undefined,
        })
        expect(res.statusCode, `${method} ${url}`).toBe(403)
        expect(res.json()).toMatchObject({ code: 'TERMS_ACCEPTANCE_REQUIRED' })
      }
    } finally {
      await app.close()
    }
  })

  it('un compte antérieur à la fonction (terms_version null) doit accepter à sa connexion', async () => {
    const { app } = await buildApp()
    try {
      const email = 'compte-ancien@example.com'
      await signUpAccepting(app, email)
      await setTermsVersion(email, null)
      const signIn = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email, password: PASSWORD },
        headers: { 'content-type': 'application/json' },
      })
      expect(signIn.statusCode).toBe(200)
      const cookie = cookieOf(signIn)
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
      expect(me.json()).toMatchObject({ termsAcceptanceRequired: true })
      const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
      expect(quizzes.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('laisse ouvertes la lecture de session et la déconnexion', async () => {
    const { app } = await buildApp()
    try {
      const email = 'routes-ouvertes@example.com'
      const cookie = await signUpAccepting(app, email)
      await setTermsVersion(email, '2025-01-01')
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
      expect(me.statusCode).toBe(200)
      expect(me.json()).toMatchObject({ termsAcceptanceRequired: true, user: { email } })
      const session = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { cookie } })
      expect(session.statusCode).toBe(200)
      const signOut = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { cookie, 'content-type': 'application/json' },
        payload: {},
      })
      expect(signOut.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it("POST /api/legal/accept enregistre la version courante à l'heure du serveur et rouvre l'API", async () => {
    const { app } = await buildApp()
    try {
      const email = 'accepte-nouvelle@example.com'
      const cookie = await signUpAccepting(app, email)
      await setTermsVersion(email, '2025-01-01')
      const before = Date.now()
      const res = await app.inject({
        method: 'POST',
        url: '/api/legal/accept',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { version: VERSION, acceptedAt: '2000-01-01T00:00:00Z' },
      })
      expect(res.statusCode).toBe(200)
      const [row] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, email))
      expect(row.termsVersion).toBe(VERSION)
      expect(row.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect(row.termsAcceptedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
      const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
      expect(quizzes.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('POST /api/legal/accept refuse une autre version que la courante (409) et exige une session (401)', async () => {
    const { app } = await buildApp()
    try {
      const email = 'accepte-perimee@example.com'
      const cookie = await signUpAccepting(app, email)
      await setTermsVersion(email, '2025-01-01')
      const stale = await app.inject({
        method: 'POST',
        url: '/api/legal/accept',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { version: '2025-01-01' },
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ code: 'TERMS_VERSION_MISMATCH' })
      const anonymous = await app.inject({
        method: 'POST',
        url: '/api/legal/accept',
        headers: { 'content-type': 'application/json' },
        payload: { version: VERSION },
      })
      expect(anonymous.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it("sans LEGAL_TERMS_VERSION, un compte sans acceptation n'est jamais bloqué", async () => {
    const { app } = await buildApp({})
    try {
      const res = await signUp(app, 'self-host@example.com')
      expect(res.statusCode).toBe(200)
      const cookie = cookieOf(res)
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
      expect(me.json()).toMatchObject({ termsAcceptanceRequired: false })
      const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
      expect(quizzes.statusCode).toBe(200)
      const accept = await app.inject({
        method: 'POST',
        url: '/api/legal/accept',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { version: VERSION },
      })
      expect(accept.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('partie en cours et joueurs', () => {
  it("un changement de version ne coupe ni l'hôte en pleine partie ni les joueurs qui rejoignent", async () => {
    const { app, url } = await buildApp()
    const clients: ClientSocket[] = []
    try {
      const email = 'hote-en-partie@example.com'
      const cookie = await signUpAccepting(app, email)
      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        payload: { title: 'Partie CGU' },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(quizRes.statusCode).toBe(201)
      const quiz = quizRes.json() as { id: string }
      const qRes = await app.inject({
        method: 'POST',
        url: `/api/quizzes/${quiz.id}/questions`,
        payload: {
          type: 'truefalse',
          prompt: 'Le manchot vole.',
          timeLimit: 5,
          readingTime: 0,
          payload: { correct: false },
        },
        headers: { 'content-type': 'application/json', cookie },
      })
      expect(qRes.statusCode).toBe(201)

      const hostSocket = await connectClient(url, { cookie })
      clients.push(hostSocket)
      const created = await ack<{ sessionId?: string; pin?: string; error?: string }>(hostSocket, 'host:create', {
        quizId: quiz.id,
      })
      expect(created.error).toBeUndefined()

      // Nouvelle version des CGU pendant le lobby.
      await setTermsVersion(email, '2025-01-01')

      // Un joueur, sans compte, rejoint par le code : jamais bloqué.
      const player = await connectClient(url)
      clients.push(player)
      const joined = await ack<{ playerId?: string; error?: string }>(player, 'player:join', {
        pin: created.pin,
        nickname: 'Pingu',
      })
      expect(joined.error).toBeUndefined()
      expect(joined.playerId).toBeTruthy()

      // L'hôte mène sa partie : démarrage accepté malgré la version périmée.
      const started = await ack<{ error?: string }>(hostSocket, 'host:start', {})
      expect(started.error).toBeUndefined()

      // Une reconnexion (rechargement de page, coupure réseau) reprend la partie elle aussi.
      hostSocket.disconnect()
      const hostAgain = await connectClient(url, { cookie })
      clients.push(hostAgain)
      const resumed = await ack<{ error?: string }>(hostAgain, 'host:reconnect', { sessionId: created.sessionId })
      expect(resumed.error).toBeUndefined()

      // Seule l'API REST (navigation suivante) demande la revalidation.
      const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
      expect(quizzes.statusCode).toBe(403)
    } finally {
      for (const c of clients) c.disconnect()
      await app.close()
    }
  })
})
