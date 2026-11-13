import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { requirePermission } from './require-permission.js'
import { registerRequireUser, requireUser, resolveContextOr403 } from './require-user.js'
import { loadConfig } from '@splootlabs/shared'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('requireUser', () => {
  it('protège une route : 401 sans session', async () => {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    registerRequireUser(app, auth)
    app.get('/api/protected', { preHandler: requireUser }, async (req) => ({ id: req.user.id }))
    const res = await app.inject({ method: 'GET', url: '/api/protected' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  // Avec un hook `onSend` asynchrone, la réponse d'un garde ne part pas dans le même tour. Un garde
  // qui répondrait sans renvoyer `reply` laisserait Fastify enchaîner sur le gestionnaire de la
  // route, exécuté alors sans utilisateur.
  it("n'exécute jamais le gestionnaire d'une requête refusée, même avec un hook onSend asynchrone", async () => {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    registerRequireUser(app, auth)
    app.addHook('onSend', async () => {})
    const reached: string[] = []
    app.post('/api/protected-write', { preHandler: requireUser }, async (_req, reply) => {
      reached.push('requireUser')
      return reply.code(400).send({ error: 'gestionnaire atteint' })
    })
    app.post(
      '/api/workspaces/:tenantId/protected-write',
      { preHandler: [requireUser, requirePermission(ctx.db, 'members:manage')] },
      async (_req, reply) => {
        reached.push('requirePermission')
        return reply.code(400).send({ error: 'gestionnaire atteint' })
      },
    )
    const headers = { 'content-type': 'application/json' }

    const anonymous = await app.inject({ method: 'POST', url: '/api/protected-write', payload: {}, headers })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json()).toEqual({ error: 'Non authentifié.' })

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'garde-onsend@example.com', password: 'motdepasse-123456', name: 'Garde' },
      headers,
    })
    const cookie = ([] as string[])
      .concat(signUp.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')
    const notMember = await app.inject({
      method: 'POST',
      url: '/api/workspaces/00000000-0000-4000-8000-000000000000/protected-write',
      payload: {},
      headers: { ...headers, cookie },
    })
    expect(notMember.statusCode).toBe(403)

    expect(reached).toEqual([])
    await app.close()
  })
})

describe('resolveContextOr403 : ne masque QUE le refus de membership en 403', () => {
  it('mode multi, sans membership sur le tenant demandé → 403 (pas 500)', async () => {
    const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi' })
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: config.tenancyMode,
    })
    const app = await buildServer(config, { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    registerRequireUser(app, auth)
    app.get('/api/scoped', { preHandler: requireUser }, async (req, reply) => {
      const context = await resolveContextOr403(req, reply, ctx.db, config)
      if (!context) return
      return { tenantId: context.tenantId }
    })

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'scope-403@example.com', password: 'motdepasse-123456', name: 'Sans Membership' },
      headers: { 'content-type': 'application/json' },
    })
    const rawCookies = signUp.headers['set-cookie']
    const cookie = Array.isArray(rawCookies)
      ? rawCookies.map((c) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0]

    // Tenant existant mais auquel l'utilisateur n'a jamais été rattaché : `resolveTenantId`
    // lève « accès refusé : aucune appartenance à ce tenant » → doit devenir 403, pas 500.
    const res = await app.inject({
      method: 'GET',
      url: '/api/scoped',
      headers: { cookie, 'x-tenant-id': '00000000-0000-0000-0000-000000000000' },
    })
    expect(res.statusCode).toBe(403)

    await app.close()
  })

  it('mode multi, erreur NON liée au membership (tenant explicite manquant) → 500, pas 403', async () => {
    const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi' })
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: config.tenancyMode,
    })
    const app = await buildServer(config, { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    registerRequireUser(app, auth)
    app.get('/api/scoped', { preHandler: requireUser }, async (req, reply) => {
      const context = await resolveContextOr403(req, reply, ctx.db, config)
      if (!context) return
      return { tenantId: context.tenantId }
    })

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'scope-500@example.com', password: 'motdepasse-123456', name: 'Sans Tenant Explicite' },
      headers: { 'content-type': 'application/json' },
    })
    const rawCookies = signUp.headers['set-cookie']
    const cookie = Array.isArray(rawCookies)
      ? rawCookies.map((c) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0]

    // Pas de header x-tenant-id : `resolveTenantId` lève « mode multi : un tenant explicite
    // est requis » — un message qui NE contient PAS « accès refusé ». `resolveScopeOr403`
    // doit relancer cette erreur (Fastify répond 500), pas la maquiller en 403.
    const res = await app.inject({ method: 'GET', url: '/api/scoped', headers: { cookie } })
    expect(res.statusCode).toBe(500)

    await app.close()
  })
})

describe('requireUser et hôte invité', () => {
  it("refuse l'invité sur une route ordinaire et le laisse passer sur une route guestAllowed", async () => {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: 'multi',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    registerRequireUser(app, auth)
    app.addHook('onSend', async () => {})
    let reached = false
    app.post('/api/ordinaire', { preHandler: requireUser }, async () => {
      reached = true
      return { ok: true }
    })
    app.get('/api/ouverte-aux-invites', { preHandler: requireUser, config: { guestAllowed: true } }, async (req) => ({
      isAnonymous: req.user.isAnonymous,
    }))

    const guest = await auth.api.signInAnonymous({ headers: new Headers(), returnHeaders: true })
    const cookie = guest.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')

    const refused = await app.inject({
      method: 'POST',
      url: '/api/ordinaire',
      payload: {},
      headers: { cookie, 'content-type': 'application/json' },
    })
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual({
      error: 'Créez un compte gratuit pour utiliser cette fonction.',
      code: 'GUEST_NOT_ALLOWED',
    })
    expect(reached).toBe(false)

    const allowed = await app.inject({ method: 'GET', url: '/api/ouverte-aux-invites', headers: { cookie } })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toEqual({ isAnonymous: true })
    await app.close()
  })
})
