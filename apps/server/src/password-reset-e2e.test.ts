import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
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

async function buildApp(
  mailer: Mailer,
  opts: { rateLimitEnabled?: boolean; logger?: ReturnType<typeof captureLogger> } = {},
) {
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

/** Demande un lien de réinitialisation, en extrait le jeton et vide la boîte du mailer. */
async function requestResetToken(app: Awaited<ReturnType<typeof buildApp>>, mailer: MemoryMailer, email: string) {
  mailer.sent.length = 0 // l'inscription envoie la confirmation d'adresse, hors sujet ici
  const request = await post(app, '/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })
  expect(request.statusCode).toBe(200)
  await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
  const token = /\/api\/auth\/reset-password\/([^?\s]+)/.exec(mailer.sent[0].text)?.[1]
  if (!token) throw new Error('Aucun jeton dans le lien de réinitialisation')
  mailer.sent.length = 0
  return token
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

  it('prévient le titulaire une fois le mot de passe modifié', async () => {
    const mailer = new MemoryMailer()
    const logger = captureLogger()
    const app = await buildApp(mailer, { logger })
    const email = 'prevenu@example.com'
    await post(app, '/api/auth/sign-up/email', { email, password: 'ancien-motdepasse-123', name: 'Prévenu' })

    const token = await requestResetToken(app, mailer, email)
    expect(mailer.sent).toHaveLength(0)

    const reset = await post(app, '/api/auth/reset-password', { newPassword: 'nouveau-motdepasse-456', token })
    expect(reset.statusCode).toBe(200)

    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    const [mail] = mailer.sent
    expect(mail.kind).toBe('password-changed')
    expect(mail.to).toBe(email)
    expect(mail.subject).toBe('Votre mot de passe Pengou a été modifié')
    expect(mail.text).toContain(`${BASE_URL}/forgot-password`)
    expect(mail.text).not.toContain(token)
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith(
        { kind: 'password-changed', transport: 'smtp', domain: 'example.com', ok: true },
        expect.any(String),
      ),
    )

    await app.close()
  })

  it("garde la réinitialisation réussie quand l'e-mail de confirmation échoue", async () => {
    const mailer = new MemoryMailer()
    const logger = captureLogger()
    const app = await buildApp(mailer, { logger })
    const email = 'echec-envoi@example.com'
    const newPassword = 'nouveau-motdepasse-456'
    await post(app, '/api/auth/sign-up/email', { email, password: 'ancien-motdepasse-123', name: 'Échec' })

    const token = await requestResetToken(app, mailer, email)
    mailer.failNext()
    const reset = await post(app, '/api/auth/reset-password', { newPassword, token })
    expect(reset.statusCode).toBe(200)
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'password-changed', transport: 'smtp', domain: 'example.com' }),
        expect.any(String),
      ),
    )

    const withNew = await post(app, '/api/auth/sign-in/email', { email, password: newPassword })
    expect(withNew.statusCode).toBe(200)

    await app.close()
  })

  it.each(['google', 'facebook'])(
    'crée un mot de passe pour un compte %s, sans retirer le fournisseur',
    async (provider) => {
      const mailer = new MemoryMailer()
      const app = await buildApp(mailer)
      const userId = randomUUID()
      const email = `social-${provider}@example.com`
      const newPassword = 'premier-motdepasse-789'
      await ctx.db.insert(schema.user).values({ id: userId, name: 'Social', email, emailVerified: true })
      await ctx.db
        .insert(schema.account)
        .values({ id: randomUUID(), userId, providerId: provider, accountId: `id-${provider}` })

      const before = await post(app, '/api/auth/sign-in/email', { email, password: newPassword })
      expect(before.statusCode).not.toBe(200)

      const token = await requestResetToken(app, mailer, email)
      const reset = await post(app, '/api/auth/reset-password', { newPassword, token })
      expect(reset.statusCode).toBe(200)

      const accounts = await ctx.db.select().from(schema.account).where(eq(schema.account.userId, userId))
      expect(accounts.map((a) => a.providerId).sort()).toEqual(['credential', provider].sort())
      const after = await post(app, '/api/auth/sign-in/email', { email, password: newPassword })
      expect(after.statusCode).toBe(200)
      await vi.waitFor(() => expect(mailer.sent.map((m) => m.kind)).toEqual(['password-changed']))

      await app.close()
    },
  )

  it("répond pareil pour une adresse inconnue et n'envoie rien", async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const email = 'connu@example.com'
    await post(app, '/api/auth/sign-up/email', { email, password: 'motdepasse-123456', name: 'Connu' })
    mailer.sent.length = 0

    const known = await post(app, '/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    const unknown = await post(app, '/api/auth/request-password-reset', {
      email: 'inconnu@example.com',
      redirectTo: '/reset-password',
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
    const ask = () =>
      post(app, '/api/auth/request-password-reset', {
        email: 'limite@example.com',
        redirectTo: '/reset-password',
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
    expect(res.json()).toEqual({ mailEnabled: true, demoEnabled: false, demoMaxPlayers: 30 })
    await app.close()
  })

  it("annonce mailEnabled: false sans transport, et la demande de réinitialisation n'envoie rien", async () => {
    const logger = captureLogger()
    const mailer = createMailer({ transport: 'none' }, logger)
    const send = vi.spyOn(mailer, 'send')
    const app = await buildApp(mailer, { logger })
    const res = await app.inject({ method: 'GET', url: '/api/auth-features' })
    expect(res.json()).toEqual({ mailEnabled: false, demoEnabled: false, demoMaxPlayers: 30 })

    const signUp = await post(app, '/api/auth/sign-up/email', {
      email: 'sans-envoi@example.com',
      password: 'motdepasse-123456',
      name: 'Sans envoi',
    })
    expect(signUp.statusCode).toBe(200)
    const request = await post(app, '/api/auth/request-password-reset', {
      email: 'sans-envoi@example.com',
      redirectTo: '/reset-password',
    })
    expect(request.statusCode).toBeLessThan(500)
    expect(send).not.toHaveBeenCalled()

    await app.close()
  })

  it("envoie confirmation, réinitialisation et avis dans la langue d'Accept-Language", async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer, { logger: captureLogger() })
    const email = 'idioma@example.com'
    const send = (url: string, payload: object, lang: string) =>
      app.inject({
        method: 'POST',
        url,
        payload,
        headers: { 'content-type': 'application/json', 'accept-language': lang },
      })

    await send(
      '/api/auth/sign-up/email',
      { email, password: 'ancien-motdepasse-123', name: 'Idioma' },
      'es-ES,es;q=0.9',
    )
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    expect(mailer.sent[0].subject).toBe('Confirma tu dirección de correo en Pengou')
    mailer.sent.length = 0

    await send('/api/auth/request-password-reset', { email, redirectTo: '/reset-password' }, 'en-US,en;q=0.9')
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    expect(mailer.sent[0].subject).toBe('Reset your Pengou password')
    const token = /\/api\/auth\/reset-password\/([^?\s]+)/.exec(mailer.sent[0].text)?.[1]
    mailer.sent.length = 0

    await send('/api/auth/reset-password', { newPassword: 'nouveau-motdepasse-456', token }, 'es')
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    expect(mailer.sent[0].subject).toBe('Tu contraseña de Pengou ha cambiado')
  })

  it("renvoie la confirmation d'adresse dans la langue d'Accept-Language", async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer, { logger: captureLogger() })
    const email = 'reenvio@example.com'
    await post(app, '/api/auth/sign-up/email', { email, password: 'ancien-motdepasse-123', name: 'Reenvio' })
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    mailer.sent.length = 0

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/send-verification-email',
      payload: { email, callbackURL: '/' },
      headers: { 'content-type': 'application/json', 'accept-language': 'es-ES,es;q=0.9' },
    })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1))
    expect(mailer.sent[0].subject).toBe('Confirma tu dirección de correo en Pengou')

    await app.close()
  })
})
