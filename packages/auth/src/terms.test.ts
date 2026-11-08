import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
import { createAuth, type Auth } from './auth.js'
import { applyTermsOnUserCreate, TERMS_ACCEPTANCE_REQUIRED } from './terms.js'

const VERSION = '2026-10-31'
const PASSWORD = 'motdepasse-solide-123'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let auth: Auth
let authSansCgu: Auth

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const base = {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: 'single' as const,
  }
  auth = createAuth(ctx.db, { ...base, termsVersion: VERSION })
  authSansCgu = createAuth(ctx.db, base)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

async function findUser(email: string) {
  const [row] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, email))
  return row
}

/** Le code d'erreur Better Auth (`APIError.body.code`) d'un appel rejeté. */
async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    return (err as { body?: { code?: string } }).body?.code
  }
  throw new Error("appel accepté alors qu'un refus était attendu")
}

describe('inscription e-mail avec CGU activées', () => {
  it("refuse la création du compte sans acceptation des CGU, et n'écrit rien en base", async () => {
    const email = 'sans-acceptation@example.com'
    const code = await rejectionCode(auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Sans' } }))
    expect(code).toBe(TERMS_ACCEPTANCE_REQUIRED)
    expect(await findUser(email)).toBeUndefined()
  })

  it("refuse l'acceptation d'une autre version que la version courante", async () => {
    const email = 'version-perimee@example.com'
    const code = await rejectionCode(
      auth.api.signUpEmail({
        body: { email, password: PASSWORD, name: 'Périmée', acceptedTermsVersion: '2025-01-01', ageConfirmed: true },
      }),
    )
    expect(code).toBe(TERMS_ACCEPTANCE_REQUIRED)
    expect(await findUser(email)).toBeUndefined()
  })

  it("refuse l'inscription sans confirmation de l'âge minimum", async () => {
    const email = 'sans-age@example.com'
    const code = await rejectionCode(
      auth.api.signUpEmail({
        body: { email, password: PASSWORD, name: 'Âge', acceptedTermsVersion: VERSION },
      }),
    )
    expect(code).toBe(TERMS_ACCEPTANCE_REQUIRED)
    expect(await findUser(email)).toBeUndefined()
  })

  it("enregistre la version acceptée et l'heure du serveur", async () => {
    const email = 'acceptation@example.com'
    const before = Date.now()
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Accepte', acceptedTermsVersion: VERSION, ageConfirmed: true },
    })
    const after = Date.now()
    const row = await findUser(email)
    expect(row.termsVersion).toBe(VERSION)
    expect(row.termsAcceptedAt).toBeInstanceOf(Date)
    expect(row.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(row.termsAcceptedAt!.getTime()).toBeLessThanOrEqual(after + 1000)
  })

  it("ignore toute date d'acceptation envoyée par le client (champ refusé)", async () => {
    const email = 'date-client@example.com'
    await expect(
      auth.api.signUpEmail({
        body: {
          email,
          password: PASSWORD,
          name: 'Client',
          acceptedTermsVersion: VERSION,
          ageConfirmed: true,
          termsAcceptedAt: '2000-01-01T00:00:00Z',
        } as never,
      }),
    ).rejects.toThrow()
    expect(await findUser(email)).toBeUndefined()
  })

  it('refuse que le client fixe lui-même terms_version', async () => {
    const email = 'version-client@example.com'
    await expect(
      auth.api.signUpEmail({
        body: { email, password: PASSWORD, name: 'Client', termsVersion: VERSION } as never,
      }),
    ).rejects.toThrow()
    expect(await findUser(email)).toBeUndefined()
  })
})

describe('inscription e-mail avec CGU désactivées', () => {
  it('fonctionne comme avant, sans case à cocher, et laisse terms_version à null', async () => {
    const email = 'auto-heberge@example.com'
    await authSansCgu.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Self-host' } })
    const row = await findUser(email)
    expect(row.termsVersion).toBeNull()
    expect(row.termsAcceptedAt).toBeNull()
  })
})

describe('applyTermsOnUserCreate (hook databaseHooks.user.create.before)', () => {
  const user = { name: 'Social', email: 'social@example.com', emailVerified: true }
  const now = new Date('2026-11-04T10:00:00Z')

  it('un compte créé par un fournisseur tiers (callback OAuth) garde terms_version à null', () => {
    const result = applyTermsOnUserCreate(
      VERSION,
      user,
      {
        path: '/callback/:id',
        body: { acceptedTermsVersion: VERSION, ageConfirmed: true },
      },
      now,
    )
    expect(result.data).toMatchObject({ termsVersion: null, termsAcceptedAt: null })
  })

  it('un compte créé hors requête (contexte absent) garde terms_version à null', () => {
    const result = applyTermsOnUserCreate(VERSION, user, null, now)
    expect(result.data).toMatchObject({ termsVersion: null, termsAcceptedAt: null })
  })

  it("horodate l'acceptation avec l'horloge du serveur", () => {
    const result = applyTermsOnUserCreate(
      VERSION,
      user,
      {
        path: '/sign-up/email',
        body: { acceptedTermsVersion: VERSION, ageConfirmed: true, termsAcceptedAt: '2000-01-01' },
      },
      now,
    )
    expect(result.data).toMatchObject({ termsVersion: VERSION, termsAcceptedAt: now })
  })

  it('sans version configurée, ne touche pas aux données', () => {
    const result = applyTermsOnUserCreate(undefined, user, { path: '/sign-up/email', body: {} }, now)
    expect(result.data).toEqual(user)
  })
})
