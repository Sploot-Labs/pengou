import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema, ensureDefaultTenant, listUserWorkspaces } from '@splootlabs/db'
import { MemoryMailer } from '@splootlabs/mail'
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

afterAll(async () => {
  await ctx?.stop()
})

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

    const [m] = await ctx.db.select().from(schema.membership).where(eq(schema.membership.userId, userId))
    expect(m).toBeTruthy()
    expect(m.tenantId).toBe(defaultTenantId)
    expect(m.role).toBe('member') // 2e inscrit (hote@pengou.app du test précédent était le 1er)

    // Le 1er inscrit (hote@pengou.app) est bien owner.
    const [hote] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'hote@pengou.app'))
    const [mHote] = await ctx.db.select().from(schema.membership).where(eq(schema.membership.userId, hote.id))
    expect(mHote.role).toBe('owner')
  })
})

describe("Better Auth et l'envoi d'e-mails", () => {
  const base = { secret: 'test-secret-at-least-32-chars-long!!', baseURL: 'http://localhost:3000' }

  it("sans mailer actif, aucun hook d'envoi n'est branché", () => {
    for (const mailer of [undefined, new MemoryMailer({ enabled: false })]) {
      const a = createAuth(ctx.db, { ...base, mailer })
      expect(a.options.emailAndPassword?.sendResetPassword).toBeUndefined()
      expect(a.options.emailAndPassword?.onPasswordReset).toBeUndefined()
      expect(a.options.emailVerification).toBeUndefined()
    }
  })

  it('avec un mailer actif, durées et révocation des sessions conformes', () => {
    const a = createAuth(ctx.db, { ...base, mailer: new MemoryMailer() })
    expect(a.options.emailAndPassword).toMatchObject({
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
    })
    expect(a.options.emailAndPassword?.requireEmailVerification).toBeFalsy()
    expect(a.options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      expiresIn: 86400,
      autoSignInAfterVerification: true,
    })
  })

  it('le limiteur suit nodeEnv, sauf si rateLimitEnabled le force', () => {
    expect(createAuth(ctx.db, base).options.rateLimit?.enabled).toBe(false)
    expect(createAuth(ctx.db, { ...base, nodeEnv: 'production' }).options.rateLimit?.enabled).toBe(true)
    expect(createAuth(ctx.db, { ...base, rateLimitEnabled: true }).options.rateLimit?.enabled).toBe(true)
    expect(createAuth(ctx.db, base).options.rateLimit?.customRules).toEqual({
      '/request-password-reset': { window: 600, max: 3 },
      '/send-verification-email': { window: 600, max: 3 },
    })
  })
})

describe('Compte invité de la démonstration', () => {
  const multi = () =>
    createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: 'multi',
    })

  /** En-tête Cookie rejouant les cookies posés par une réponse de Better Auth. */
  const cookieFrom = (headers: Headers) =>
    headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')

  it('crée un invité sans adresse réelle, avec son espace en mode multi', async () => {
    const { response } = await multi().api.signInAnonymous({ headers: new Headers(), returnHeaders: true })
    const [row] = await ctx.db.select().from(schema.user).where(eq(schema.user.id, response!.user.id))
    expect(row.isAnonymous).toBe(true)
    expect(row.name).toBe('Invité')
    expect(row.email.endsWith('@invite.invalid')).toBe(true)
    expect(await listUserWorkspaces(ctx.db, row.id)).toHaveLength(1)
  })

  it("laisse l'invité en place quand un compte ordinaire est créé avec son cookie", async () => {
    const guestAuth = multi()
    const { headers, response } = await guestAuth.api.signInAnonymous({ headers: new Headers(), returnHeaders: true })
    const guestId = response!.user.id

    const signUp = await guestAuth.api.signUpEmail({
      body: { email: 'apres-demo@pengou.app', password: 'motdepasse-solide-123', name: 'Après Démo' },
      headers: new Headers({ cookie: cookieFrom(headers) }),
    })

    const [guest] = await ctx.db.select().from(schema.user).where(eq(schema.user.id, guestId))
    expect(guest?.isAnonymous).toBe(true)
    const [created] = await ctx.db.select().from(schema.user).where(eq(schema.user.id, signUp.user.id))
    expect(created.isAnonymous).toBe(false)
    expect(created.id).not.toBe(guestId)
    expect(await listUserWorkspaces(ctx.db, created.id)).toHaveLength(1)
  })
})
