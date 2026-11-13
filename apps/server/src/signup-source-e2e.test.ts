import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { runMigrations, schema, startTestDb } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'

// Provenance des inscriptions : le champ `from` envoyé par le formulaire est normalisé et écrit
// dans user.signup_source par le serveur, sans cookie ni autre trace.

let ctx: Awaited<ReturnType<typeof startTestDb>>
let app: FastifyInstance

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
  })
  app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth, { legal: null })
}, 120_000)

afterAll(async () => {
  await app?.close()
  await ctx?.stop()
})

function signUp(email: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Hôte', ...extra },
    headers: { 'content-type': 'application/json' },
  })
}

async function sourceOf(email: string): Promise<string | null | undefined> {
  const [row] = await ctx.db
    .select({ signupSource: schema.user.signupSource })
    .from(schema.user)
    .where(eq(schema.user.email, email))
  return row?.signupSource
}

describe("provenance de l'inscription", () => {
  it('enregistre le slug normalisé envoyé dans `from`', async () => {
    const res = await signUp('source-1@example.org', { from: 'Kahoot-Gratuit-Sans-Compte' })
    expect(res.statusCode).toBe(200)
    expect(await sourceOf('source-1@example.org')).toBe('kahoot-gratuit-sans-compte')
    // Rien de plus que le cookie de session habituel de Better Auth.
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
    expect(cookies.every((c) => c.startsWith('better-auth.'))).toBe(true)
  })

  it('garde la provenance côté serveur : ni la réponse ni la session ne la renvoient au navigateur', async () => {
    const res = await signUp('source-5@example.org', { from: 'tarifs' })
    expect(res.statusCode).toBe(200)
    expect(await sourceOf('source-5@example.org')).toBe('tarifs')
    expect(res.body).not.toContain('signupSource')
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')
    const session = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { cookie } })
    expect(session.statusCode).toBe(200)
    expect(session.json()).toMatchObject({ user: { email: 'source-5@example.org' } })
    expect(session.body).not.toContain('signupSource')
  })

  it('laisse null sans provenance et ignore une valeur invalide sans refuser', async () => {
    expect((await signUp('source-2@example.org')).statusCode).toBe(200)
    expect(await sourceOf('source-2@example.org')).toBeNull()
    expect((await signUp('source-3@example.org', { from: "'; drop table user; --" })).statusCode).toBe(200)
    expect(await sourceOf('source-3@example.org')).toBeNull()
  })

  it('ne laisse pas le client fixer la colonne directement', async () => {
    const res = await signUp('source-4@example.org', { signupSource: 'pirate' })
    if (res.statusCode === 200) expect(await sourceOf('source-4@example.org')).toBeNull()
    else expect(await sourceOf('source-4@example.org')).toBeUndefined()
  })

  it('la base refuse une provenance qui ne serait pas un slug', async () => {
    await expect(
      ctx.db
        .update(schema.user)
        .set({ signupSource: 'Pas Un Slug' })
        .where(eq(schema.user.email, 'source-2@example.org')),
    ).rejects.toThrow()
  })
})
