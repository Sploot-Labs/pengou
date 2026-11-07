import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { createMailer, MemoryMailer, type Mailer } from '@splootlabs/mail'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

const BASE_URL = 'http://localhost:3000'

function captureLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

async function buildApp(mailer: Mailer, opts: { rateLimitEnabled?: boolean; logger?: ReturnType<typeof captureLogger> } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi' })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: BASE_URL,
    tenancyMode: config.tenancyMode,
    mailer,
    mailTransport: 'smtp',
    logger: opts.logger ?? captureLogger(),
    rateLimitEnabled: opts.rateLimitEnabled,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth, { mailEnabled: mailer.enabled })
  return app
}

function post(app: Awaited<ReturnType<typeof buildApp>>, url: string, payload: object) {
  return app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json' } })
}

describe('e2e : réinitialisation du mot de passe', () => {
  it('demande, lien reçu, nouveau mot de passe, ancien refusé', async () => {
    const mailer = new MemoryMailer()
    const logger = captureLogger()
    const app = await buildApp(mailer, { logger })
    const email = 'oubli@example.com'
    const oldPassword = 'ancien-motdepasse-123'
    const newPassword = 'nouveau-motdepasse-456'

    const signUp = await post(app, '/api/auth/sign-up/email', { email, password: oldPassword, name: 'Oubli' })
    expect(signUp.statusCode).toBe(200)
    mailer.sent.length = 0 // l'inscription envoie la confirmation d'adresse, hors sujet ici

    const request = await post(app, '/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })
    expect(request.statusCode).toBe(200)
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    const [mail] = mailer.sent
    expect(mail.kind).toBe('reset-password')
    expect(mail.to).toBe(email)
    expect(mail.text).toContain(`${BASE_URL}/api/auth/reset-password/`)

    const token = /\/api\/auth\/reset-password\/([^?\s]+)/.exec(mail.text)?.[1]
    expect(token).toBeTruthy()

    // Le journal dit quoi, par où et vers quel domaine, jamais le token ni l'adresse complète.
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith(
        { kind: 'reset-password', transport: 'smtp', domain: 'example.com', ok: true },
        expect.any(String),
      ),
    )
    const dump = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])
    expect(dump).not.toContain(token!)
    expect(dump).not.toContain(email)

    const reset = await post(app, '/api/auth/reset-password', { newPassword, token })
    expect(reset.statusCode).toBe(200)

    const withOld = await post(app, '/api/auth/sign-in/email', { email, password: oldPassword })
    expect(withOld.statusCode).not.toBe(200)
    const withNew = await post(app, '/api/auth/sign-in/email', { email, password: newPassword })
    expect(withNew.statusCode).toBe(200)

    await app.close()
  })

  it("répond pareil pour une adresse inconnue et n'envoie rien", async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const email = 'connu@example.com'
    await post(app, '/api/auth/sign-up/email', { email, password: 'motdepasse-123456', name: 'Connu' })
    mailer.sent.length = 0

    const known = await post(app, '/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    const unknown = await post(app, '/api/auth/request-password-reset', {
      email: 'inconnu@example.com', redirectTo: '/reset-password',
    })
    expect(unknown.statusCode).toBe(known.statusCode)
    expect(unknown.json()).toEqual(known.json())
    // Laisse le temps à un éventuel envoi non attendu de partir avant de compter.
    await new Promise((r) => setTimeout(r, 50))
    expect(mailer.sent).toHaveLength(1)

    await app.close()
  })

  it('limite à 3 demandes par 10 minutes et par IP', async () => {
    const app = await buildApp(new MemoryMailer(), { rateLimitEnabled: true })
    const ask = () => post(app, '/api/auth/request-password-reset', {
      email: 'limite@example.com', redirectTo: '/reset-password',
    })
    for (let i = 0; i < 3; i++) expect((await ask()).statusCode).toBe(200)

    // Deux minutes plus tard : la règle intégrée (3 par 60 s) laisserait passer, la nôtre non.
    const realNow = Date.now
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 120_000)
    try {
      expect((await ask()).statusCode).toBe(429)
    } finally {
      spy.mockRestore()
    }

    await app.close()
  })
})

describe('GET /api/auth-features', () => {
  it('annonce mailEnabled: true avec un mailer actif', async () => {
    const app = await buildApp(new MemoryMailer())
    const res = await app.inject({ method: 'GET', url: '/api/auth-features' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ mailEnabled: true })
    await app.close()
  })

  it("annonce mailEnabled: false sans transport, et la demande de réinitialisation n'envoie rien", async () => {
    const logger = captureLogger()
    const mailer = createMailer({ transport: 'none' }, logger)
    const send = vi.spyOn(mailer, 'send')
    const app = await buildApp(mailer, { logger })
    const res = await app.inject({ method: 'GET', url: '/api/auth-features' })
    expect(res.json()).toEqual({ mailEnabled: false })

    const signUp = await post(app, '/api/auth/sign-up/email', {
      email: 'sans-envoi@example.com', password: 'motdepasse-123456', name: 'Sans envoi',
    })
    expect(signUp.statusCode).toBe(200)
    const request = await post(app, '/api/auth/request-password-reset', {
      email: 'sans-envoi@example.com', redirectTo: '/reset-password',
    })
    expect(request.statusCode).toBeLessThan(500)
    expect(send).not.toHaveBeenCalled()

    await app.close()
  })
})
