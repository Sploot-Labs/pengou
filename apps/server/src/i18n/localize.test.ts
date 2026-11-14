import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from '../app.js'
import { registerAuth } from '../auth-plugin.js'
import { langOf, localizeAuthHandler, localizeMessage, socketLang } from './localize.js'

describe('localizeMessage', () => {
  it('traduit un message exact', () => {
    expect(localizeMessage('Non authentifié.', 'en')).toBe('Not authenticated.')
    expect(localizeMessage('Non authentifié.', 'es')).toBe('No autenticado.')
    expect(localizeMessage('Non authentifié.', 'fr')).toBe('Non authentifié.')
    expect(localizeMessage('session introuvable', 'en')).toBe('game not found')
    expect(localizeMessage('session introuvable', 'es')).toBe('partida no encontrada')
    expect(localizeMessage('exclusion impossible au podium', 'en')).toBe('players cannot be kicked at the podium')
    expect(localizeMessage('joueur exclu de la partie', 'en')).toBe('player kicked from the game')
  })

  it('traduit un message variable avec sa valeur', () => {
    expect(localizeMessage('session introuvable : abc-123', 'es')).toBe('partida no encontrada: abc-123')
    expect(localizeMessage('session introuvable : abc-123', 'en')).toBe('game not found: abc-123')
    expect(localizeMessage('Le titre est trop long (200 caractères max).', 'en')).toBe(
      'The title is too long (200 characters max).',
    )
  })

  it('laisse un message inconnu inchangé, sans lire le prototype', () => {
    expect(localizeMessage('message absent du catalogue', 'en')).toBe('message absent du catalogue')
    expect(localizeMessage('constructor', 'es')).toBe('constructor')
  })
})

describe('langOf et socketLang', () => {
  it('donne la priorité à ?lang= valide, puis à Accept-Language, puis au français', () => {
    expect(langOf({ headers: { 'accept-language': 'en' }, query: { lang: 'es' } })).toBe('es')
    expect(langOf({ headers: { 'accept-language': 'en' }, query: { lang: 'de' } })).toBe('en')
    expect(langOf({ headers: { 'accept-language': 'de-DE,es;q=0.5' } })).toBe('es')
    expect(langOf({ headers: {} })).toBe('fr')
    expect(langOf({ headers: { 'accept-language': 'pt' }, query: undefined })).toBe('fr')
  })

  it('socket : auth.lang valide, sinon Accept-Language du handshake, sinon le français', () => {
    expect(socketLang({ auth: { lang: 'es' }, headers: { 'accept-language': 'en' } })).toBe('es')
    expect(socketLang({ auth: { lang: 'xx' }, headers: { 'accept-language': 'en-US' } })).toBe('en')
    expect(socketLang({ auth: {}, headers: {} })).toBe('fr')
  })

  it("socket sans auth.lang (onglet ouvert avant le déploiement) : français, quel que soit l'Accept-Language", () => {
    expect(socketLang({ auth: {}, headers: { 'accept-language': 'en-US' } })).toBe('fr')
    expect(socketLang({ auth: { tenantId: 't1' }, headers: { 'accept-language': 'es-ES,es;q=0.9' } })).toBe('fr')
    expect(socketLang({ headers: { 'accept-language': 'en' } })).toBe('fr')
  })
})

describe('localizeAuthHandler (réponses de Better Auth)', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const request = (lang?: string, query = '') =>
    new Request(`http://localhost/api/auth/sign-in/email${query}`, {
      method: 'POST',
      headers: lang ? { 'accept-language': lang } : {},
    })

  it('traduit le message par son code et garde le code', async () => {
    const handler = localizeAuthHandler(async () =>
      json(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
    )
    expect(await (await handler(request('fr'))).json()).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'E-mail ou mot de passe incorrect.',
    })
    expect(await (await handler(request('es', '?lang=en'))).json()).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Incorrect email or password.',
    })
  })

  it('traduit un message français de Pengou dont le code est inconnu, et le message du limiteur', async () => {
    const terms = localizeAuthHandler(async () =>
      json(400, {
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        message: 'Confirmez que vous avez 15 ans ou plus pour créer un compte.',
      }),
    )
    expect(await (await terms(request('en'))).json()).toEqual({
      code: 'TERMS_ACCEPTANCE_REQUIRED',
      message: 'Confirm that you are 15 or older to create an account.',
    })
    const limited = localizeAuthHandler(async () =>
      json(429, { message: 'Too many requests. Please try again later.' }, { 'x-retry-after': '10' }),
    )
    const res = await limited(request())
    expect(res.status).toBe(429)
    expect(res.headers.get('x-retry-after')).toBe('10')
    expect(await res.json()).toEqual({ message: 'Trop de tentatives. Patientez un instant puis réessayez.' })
  })

  it("garde chaque Set-Cookie d'une réponse d'erreur traduite", async () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    headers.append('set-cookie', 'a=1; Path=/; HttpOnly')
    headers.append('set-cookie', 'b=2; Path=/; HttpOnly')
    const handler = localizeAuthHandler(
      async () =>
        new Response(JSON.stringify({ code: 'INVALID_TOKEN', message: 'Invalid token' }), { status: 400, headers }),
    )
    const res = await handler(request('es'))
    expect(await res.json()).toEqual({
      code: 'INVALID_TOKEN',
      message: 'Este enlace ya no es válido. Solicita uno nuevo.',
    })
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly'])
  })

  it("laisse passer telle quelle une réponse 4xx qui n'est pas du JSON", async () => {
    const html = new Response('<p>Bad request</p>', { status: 400, headers: { 'content-type': 'text/html' } })
    const res = await localizeAuthHandler(async () => html)(request('en'))
    expect(res).toBe(html)
    expect(await res.text()).toBe('<p>Bad request</p>')
  })

  it('laisse intactes les réponses réussies et les codes inconnus au message inconnu', async () => {
    const ok = json(200, { token: 't', user: { id: 'u' } }, { 'set-cookie': 'a=1; Path=/' })
    expect(await localizeAuthHandler(async () => ok)(request('en'))).toBe(ok)
    const unknown = localizeAuthHandler(async () => json(400, { code: 'SOMETHING_NEW', message: 'Something new' }))
    expect(await (await unknown(request('es'))).json()).toEqual({ code: 'SOMETHING_NEW', message: 'Something new' })
  })
})

describe("traduction à la sortie de l'application Fastify", () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>

  beforeAll(async () => {
    ctx = await startTestDb()
    await runMigrations(ctx.db)
  }, 120_000)
  afterAll(async () => {
    await ctx?.stop()
  })

  async function build() {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    app.get('/api/test-unknown-error', async (_request, reply) => reply.code(400).send({ error: 'pas au catalogue' }))
    return app
  }

  it('traduit { error } selon Accept-Language et ?lang=, sans toucher aux autres réponses', async () => {
    const app = await build()
    try {
      const en = await app.inject({ method: 'GET', url: '/api/me', headers: { 'accept-language': 'en' } })
      expect(en.statusCode).toBe(401)
      expect(en.json()).toEqual({ error: 'Not authenticated.' })
      expect(Number(en.headers['content-length'])).toBe(Buffer.byteLength(en.body))

      const fr = await app.inject({ method: 'GET', url: '/api/me' })
      expect(fr.statusCode).toBe(401)
      expect(fr.json()).toEqual({ error: 'Non authentifié.' })

      const es = await app.inject({ method: 'GET', url: '/api/me?lang=es', headers: { 'accept-language': 'en' } })
      expect(es.json()).toEqual({ error: 'No autenticado.' })

      const unknown = await app.inject({
        method: 'GET',
        url: '/api/test-unknown-error',
        headers: { 'accept-language': 'en' },
      })
      expect(unknown.json()).toEqual({ error: 'pas au catalogue' })

      const plainFr = await app.inject({ method: 'GET', url: '/health' })
      const plainEn = await app.inject({ method: 'GET', url: '/health', headers: { 'accept-language': 'en' } })
      expect(plainEn.body).toBe(plainFr.body)
      expect(Number(plainEn.headers['content-length'])).toBe(Buffer.byteLength(plainEn.body))
    } finally {
      await app.close()
    }
  })

  it('traduit les erreurs de Better Auth par leur code (connexion avec un mauvais mot de passe)', async () => {
    const app = await build()
    const headers = { 'content-type': 'application/json' }
    try {
      const signUp = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: { email: 'langue-auth@example.com', password: 'motdepasse-123456', name: 'Langue' },
        headers,
      })
      expect(signUp.statusCode).toBe(200)

      const attempt = (lang: string) =>
        app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          payload: { email: 'langue-auth@example.com', password: 'mauvais-mot-de-passe' },
          headers: { ...headers, 'accept-language': lang },
        })
      const expected = {
        fr: 'E-mail ou mot de passe incorrect.',
        en: 'Incorrect email or password.',
        es: 'Correo electrónico o contraseña incorrectos.',
      }
      for (const [lang, message] of Object.entries(expected)) {
        const res = await attempt(lang)
        expect(res.statusCode).toBe(401)
        expect(res.json()).toEqual({ code: 'INVALID_EMAIL_OR_PASSWORD', message })
        expect(Number(res.headers['content-length'] ?? Buffer.byteLength(res.body))).toBe(Buffer.byteLength(res.body))
      }

      const tooShort = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: { email: 'langue-court@example.com', password: 'court', name: 'Court' },
        headers: { ...headers, 'accept-language': 'es' },
      })
      expect(tooShort.statusCode).toBe(400)
      expect(tooShort.json()).toMatchObject({
        code: 'PASSWORD_TOO_SHORT',
        message: 'La contraseña es demasiado corta.',
      })
    } finally {
      await app.close()
    }
  })
})
