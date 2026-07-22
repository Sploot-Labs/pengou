import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  startTestDb, runMigrations, schema, tenantScope, resolveTenantId, createQuiz,
} from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
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

describe('e2e : inscription hôte → session → quiz scopé au tenant', () => {
  it("un hôte inscrit peut s'authentifier puis créer un quiz porté par son tenant", async () => {
    const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: config.tenancyMode,
    })
    const app = buildServer(config, { dbStatus: () => 'up' })
    await registerAuth(app, auth)

    // 1. Inscription (email/mot de passe) via la route Better Auth réellement montée.
    const email = 'hote-e2e@example.com'
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email, password: 'motdepasse-123456', name: 'Hôte E2E' },
      headers: { 'content-type': 'application/json' },
    })
    expect(signUp.statusCode).toBe(200)

    // 2. Récupère le cookie de session renvoyé par l'inscription.
    const rawCookies = signUp.headers['set-cookie']
    expect(rawCookies).toBeDefined()
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0]

    // 3. /api/me authentifié : 200 + user.
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieHeader } })
    expect(me.statusCode).toBe(200)
    const meBody = me.json() as { user: { id: string; email: string } }
    expect(meBody.user.email).toBe(email)

    // Confirme l'id utilisateur à la fois via la réponse /api/me et une requête directe en base
    // (schema.user), pour ne pas dépendre uniquement de la forme de la réponse Better Auth.
    const [dbUser] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1)
    expect(dbUser).toBeDefined()
    expect(dbUser.id).toBe(meBody.user.id)

    // 4. Chaîne auth → tenant → données : via le repo, crée un quiz scopé au tenant résolu
    // pour cet utilisateur, et vérifie que le quiz porte bien le tenant par défaut et cet owner.
    const defaultTenantId = await resolveTenantId(ctx.db, { tenancyMode: 'single' }, {})
    const quiz = await createQuiz(tenantScope(ctx.db, defaultTenantId), {
      ownerId: dbUser.id,
      title: 'Q',
    })
    expect(quiz.tenantId).toBe(defaultTenantId)
    expect(quiz.ownerId).toBe(dbUser.id)

    await app.close()
  })
})
