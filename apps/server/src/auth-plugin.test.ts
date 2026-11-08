import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { loadConfig } from '@splootlabs/shared'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('routes auth + garde de session', () => {
  it('monte /api/auth et protège une route (401 sans session)', async () => {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('inscrit un hôte puis autorise /api/me avec le cookie de session', async () => {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'hote@example.com', password: 'password123456', name: 'Hôte Test' },
      headers: { 'content-type': 'application/json' },
    })
    expect(signUp.statusCode).toBe(200)

    const rawCookies = signUp.headers['set-cookie']
    expect(rawCookies).toBeDefined()
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0]

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieHeader } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ user: { email: 'hote@example.com' } })

    await app.close()
  })
})

// Constat d'audit `packages/auth/src/auth.ts:betterAuth-rateLimit-untrusted-client-ip` : la
// limite de connexion de Better Auth (3 essais par 10 s sur /sign-in) doit être indexée sur
// l'IP du pair TCP (ou celle annoncée par un proxy de confiance), jamais sur un
// X-Forwarded-For choisi par le client.
describe('limite de connexion indexée sur une IP fiable', () => {
  const secret = 'test-secret-at-least-32-chars-long!!'

  async function buildAuthApp(env: Record<string, string> = {}) {
    // nodeEnv 'production' : seul moyen d'activer le limiteur de Better Auth dans un test.
    const auth = createAuth(ctx.db, { secret, baseURL: 'http://localhost:3000', nodeEnv: 'production' })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test', ...env }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    return app
  }

  function signIn(
    app: Awaited<ReturnType<typeof buildAuthApp>>,
    remoteAddress: string,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      remoteAddress,
      payload: { email: 'inconnu@example.com', password: 'mauvais-mot-de-passe' },
      headers: { 'content-type': 'application/json', ...headers },
    })
  }

  it('changer X-Forwarded-For ne remet pas le compteur de connexion à zéro', async () => {
    const app = await buildAuthApp()
    const codes: number[] = []
    for (let i = 1; i <= 4; i++) {
      const res = await signIn(app, '203.0.113.50', { 'x-forwarded-for': `192.0.2.${i}` })
      codes.push(res.statusCode)
    }
    expect(codes).toEqual([401, 401, 401, 429])
    await app.close()
  })

  it('deux pairs distincts ne partagent pas de compteur', async () => {
    const app = await buildAuthApp()
    for (let i = 0; i < 3; i++) {
      expect((await signIn(app, '203.0.113.1')).statusCode).toBe(401)
    }
    expect((await signIn(app, '203.0.113.2')).statusCode).toBe(401)
    await app.close()
  })

  it('derrière un proxy de confiance, chaque client a son propre compteur', async () => {
    const app = await buildAuthApp({ TRUSTED_PROXIES: ' 10.0.0.0/8 , loopback ' })
    for (let i = 0; i < 3; i++) {
      const res = await signIn(app, '10.0.0.2', { 'x-forwarded-for': '198.51.100.10' })
      expect(res.statusCode).toBe(401)
    }
    expect((await signIn(app, '10.0.0.2', { 'x-forwarded-for': '198.51.100.10' })).statusCode).toBe(429)
    expect((await signIn(app, '10.0.0.2', { 'x-forwarded-for': '198.51.100.11' })).statusCode).toBe(401)
    await app.close()
  })
})

describe('TRUSTED_PROXIES', () => {
  it('se lit comme une liste séparée par des virgules, espaces retirés, vide par défaut', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).trustedProxies).toEqual([])
    expect(loadConfig({ NODE_ENV: 'test', TRUSTED_PROXIES: '' }).trustedProxies).toEqual([])
    expect(loadConfig({ NODE_ENV: 'test', TRUSTED_PROXIES: ' 10.0.0.0/8 , loopback ,' }).trustedProxies).toEqual([
      '10.0.0.0/8',
      'loopback',
    ])
  })

  it('avertit au démarrage en production quand la liste est vide', async () => {
    const env = {
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-chars-long!!',
      APP_DB_PASSWORD: 'mot-de-passe-de-test',
    }
    const message =
      'TRUSTED_PROXIES est vide : derrière un reverse proxy, tous les clients partagent la même IP pour les limites de débit.'

    const sansListe = await buildServer(loadConfig(env))
    const warnSans = vi.spyOn(sansListe.log, 'warn').mockImplementation(() => undefined)
    await sansListe.ready()
    expect(warnSans).toHaveBeenCalledWith(message)
    await sansListe.close()

    const avecListe = await buildServer(loadConfig({ ...env, TRUSTED_PROXIES: '10.0.0.0/8' }))
    const warnAvec = vi.spyOn(avecListe.log, 'warn').mockImplementation(() => undefined)
    await avecListe.ready()
    expect(warnAvec).not.toHaveBeenCalledWith(message)
    await avecListe.close()
  })
})
