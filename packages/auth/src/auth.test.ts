import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema, ensureDefaultTenant } from '@splootlabs/db'
import { createAuth, type Auth } from './auth.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let auth: Auth

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: 'single',
  })
}, 120_000)

afterAll(async () => { await ctx?.stop() })

describe('Better Auth email/mot de passe', () => {
  it('inscrit puis connecte un hôte', async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email: 'hote@pengou.app', password: 'motdepasse-solide-123', name: 'Hôte Test' },
    })
    expect(signUp.user?.email).toBe('hote@pengou.app')

    const signIn = await auth.api.signInEmail({
      body: { email: 'hote@pengou.app', password: 'motdepasse-solide-123' },
    })
    expect(signIn.user?.email).toBe('hote@pengou.app')
    expect(signIn.token).toBeTruthy()
  })

  it('mode single : 1er inscrit = owner, suivant = member (défaut de rôle)', async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email: 'membre@pengou.app', password: 'motdepasse-solide-123', name: 'Membre Test' },
    })
    const userId = signUp.user!.id
    const defaultTenantId = await ensureDefaultTenant(ctx.db)

    const [m] = await ctx.db.select().from(schema.membership)
      .where(eq(schema.membership.userId, userId))
    expect(m).toBeTruthy()
    expect(m.tenantId).toBe(defaultTenantId)
    expect(m.role).toBe('member') // 2e inscrit (hote@pengou.app du test précédent était le 1er)

    // Le 1er inscrit (hote@pengou.app) est bien owner.
    const [hote] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'hote@pengou.app'))
    const [mHote] = await ctx.db.select().from(schema.membership).where(eq(schema.membership.userId, hote.id))
    expect(mHote.role).toBe('owner')
  })
})
