import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { createWorkspace, listDemoDaily, purgeExpiredGuests, runMigrations, schema, startTestDb } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { EXAMPLE_QUIZ } from './example-quiz.js'

// POST /api/demo : la seule porte d'entrée d'un hôte invité. Elle vérifie l'acceptation (case d'âge
// et conditions d'utilisation), le budget par IP et le plafond global, puis crée l'invité, son
// espace et le quiz d'exemple.

const TERMS = '2026-10-31'
const LEGAL = {
  LEGAL_TERMS_VERSION: TERMS,
  LEGAL_TERMS_URL: 'https://pengou.fr/cgu/',
  LEGAL_PRIVACY_URL: 'https://pengou.fr/politique-de-confidentialite/',
}
const ACCEPT = { ageConfirmed: true, acceptedTermsVersion: TERMS }
const JSON_HEADERS = { 'content-type': 'application/json' }

let ctx: Awaited<ReturnType<typeof startTestDb>>
let app: FastifyInstance
let clock = Date.parse('2026-11-13T10:00:00Z')
let ipSeq = 0

/** Une IP neuve par test : le budget par IP ne fuit pas d'un test à l'autre. */
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`

const cookieOf = (setCookie: string | string[] | undefined) =>
  ([] as string[])
    .concat(setCookie ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

type DemoBody = { quizId: string; tenantId: string; liveSessionId: string | null }

async function build(
  env: Record<string, string>,
  now?: () => number,
  demo?: { copyQuiz?: () => Promise<string> },
): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi', ...LEGAL, ...env })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
    termsVersion: config.legal?.termsVersion,
  })
  const built = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(built, auth, { legal: config.legal, demo: config.demo })
  registerEditor(built, { systemDb: ctx.db, appDb: ctx.appDb, auth, config, now, demoCopyQuiz: demo?.copyQuiz })
  return built
}

function post(
  payload: unknown,
  opts: { ip?: string; cookie?: string; origin?: string; target?: FastifyInstance } = {},
) {
  return (opts.target ?? app).inject({
    method: 'POST',
    url: '/api/demo',
    payload: payload as object,
    remoteAddress: opts.ip ?? freshIp(),
    headers: {
      ...JSON_HEADERS,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
  })
}

async function guestCount(): Promise<number> {
  const rows = (await ctx.db.execute(
    sql`select count(*)::int as n from "user" where is_anonymous`,
  )) as unknown as Array<{ n: number }>
  return rows[0].n
}

/** Une partie vivante d'invité posée directement en base, pour remplir le plafond global. */
async function liveGuestSession(): Promise<void> {
  const id = `plein-${++ipSeq}`
  await ctx.db.insert(schema.user).values({ id, name: 'Invité', email: `temp-${id}@invite.invalid`, isAnonymous: true })
  const workspace = await createWorkspace(ctx.db, { name: 'Invité', ownerId: id })
  const [quiz] = await ctx.db
    .insert(schema.quiz)
    .values({ tenantId: workspace.id, ownerId: id, title: 'Quiz' })
    .returning()
  await ctx.db
    .insert(schema.gameSession)
    .values({ tenantId: workspace.id, quizId: quiz.id, hostId: id, pin: String(200000 + ipSeq), status: 'lobby' })
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  app = await build({ DEMO_ENABLED: 'true' }, () => clock)
}, 120_000)

afterAll(async () => {
  await app?.close()
  await ctx?.stop()
})

describe('POST /api/demo', () => {
  it('répond 404 DEMO_DISABLED quand la fonction est éteinte', async () => {
    const off = await build({})
    const res = await post(ACCEPT, { target: off })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: "La démonstration n'est pas disponible sur cette instance.",
      code: 'DEMO_DISABLED',
    })
    const features = await off.inject({ method: 'GET', url: '/api/auth-features' })
    expect(features.json()).toMatchObject({ demoEnabled: false })
    await off.close()
  })

  it('annonce la fonction dans /api/auth-features quand elle est active', async () => {
    const features = await app.inject({ method: 'GET', url: '/api/auth-features' })
    expect(features.json()).toMatchObject({ demoEnabled: true, demoMaxPlayers: 30 })
  })

  it("refuse sans la case d'âge, puis sans la version des conditions, sans créer de compte", async () => {
    const before = await guestCount()

    const noAge = await post({ acceptedTermsVersion: TERMS })
    expect(noAge.statusCode).toBe(400)
    expect(noAge.json()).toEqual({
      error: 'Confirmez que vous avez 15 ans ou plus pour lancer la démonstration.',
      code: 'TERMS_ACCEPTANCE_REQUIRED',
    })

    const noTerms = await post({ ageConfirmed: true })
    expect(noTerms.statusCode).toBe(400)
    expect(noTerms.json()).toEqual({
      error: "Acceptez les conditions d'utilisation pour lancer la démonstration.",
      code: 'TERMS_ACCEPTANCE_REQUIRED',
    })

    const stale = await post({ ageConfirmed: true, acceptedTermsVersion: '2020-01-01' })
    expect(stale.statusCode).toBe(400)
    expect(stale.json().code).toBe('TERMS_ACCEPTANCE_REQUIRED')

    expect(await guestCount()).toBe(before)
  })

  it("crée l'invité, son espace et le quiz d'exemple de cinq questions", async () => {
    const res = await post({ ...ACCEPT, from: 'Accueil' })
    expect(res.statusCode).toBe(201)
    const body = res.json() as DemoBody
    expect(body.liveSessionId).toBeNull()
    const cookie = cookieOf(res.headers['set-cookie'])
    expect(cookie).not.toBe('')

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ user: { isAnonymous: true }, termsAcceptanceRequired: false })

    const [row] = await ctx.db.select().from(schema.user).where(eq(schema.user.id, me.json().user.id))
    expect(row.termsVersion).toBe(TERMS)
    expect(row.termsAcceptedAt?.toISOString()).toBe(new Date(clock).toISOString())
    expect(row.signupSource).toBe('accueil')

    const [quiz] = await ctx.db.select().from(schema.quiz).where(eq(schema.quiz.id, body.quizId))
    expect(quiz).toMatchObject({ title: EXAMPLE_QUIZ.title, tenantId: body.tenantId, ownerId: row.id })
    const questions = await ctx.db.select().from(schema.question).where(eq(schema.question.quizId, body.quizId))
    expect(questions).toHaveLength(5)

    expect(await listDemoDaily(ctx.db)).toContainEqual({
      day: '2026-11-13',
      source: 'accueil',
      launched: 1,
      started: 0,
    })
  })

  it('enregistre la provenance « direct » sans paramètre from valide', async () => {
    const before = (await listDemoDaily(ctx.db)).find((r) => r.source === 'direct')?.launched ?? 0
    const res = await post({ ...ACCEPT, from: 'pas un slug !' })
    expect(res.statusCode).toBe(201)
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookieOf(res.headers['set-cookie']) },
    })
    const [row] = await ctx.db.select().from(schema.user).where(eq(schema.user.id, me.json().user.id))
    expect(row.signupSource).toBeNull()
    expect((await listDemoDaily(ctx.db)).find((r) => r.source === 'direct')?.launched).toBe(before + 1)
  })

  it("réutilise l'invité déjà connecté, sans consommer le budget ni recompter", async () => {
    const ip = freshIp()
    const first = await post({ ...ACCEPT, from: 'reprise' }, { ip })
    const cookie = cookieOf(first.headers['set-cookie'])
    const guests = await guestCount()

    // Même navigateur, second onglet : cinq nouveaux appels, sans même renvoyer l'acceptation.
    for (let i = 0; i < 5; i++) {
      const again = await post({}, { ip, cookie })
      expect(again.statusCode).toBe(201)
      expect(again.json()).toEqual(first.json())
    }

    expect(await guestCount()).toBe(guests)
    expect((await listDemoDaily(ctx.db)).find((r) => r.source === 'reprise')?.launched).toBe(1)
  })

  it("renvoie la partie vivante de l'invité déjà connecté", async () => {
    const first = await post(ACCEPT)
    const cookie = cookieOf(first.headers['set-cookie'])
    const body = first.json() as DemoBody
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    const [live] = await ctx.db
      .insert(schema.gameSession)
      .values({
        tenantId: body.tenantId,
        quizId: body.quizId,
        hostId: me.json().user.id,
        pin: '314159',
        status: 'lobby',
      })
      .returning()

    const again = await post({}, { cookie })
    expect(again.json()).toEqual({ ...body, liveSessionId: live.id })

    await ctx.db.delete(schema.gameSession).where(eq(schema.gameSession.id, live.id))
  })

  it("repart de zéro avec le cookie d'un invité purgé", async () => {
    const first = await post(ACCEPT)
    const cookie = cookieOf(first.headers['set-cookie'])
    // Seuil dans le futur : tous les invités existants sont échus.
    await purgeExpiredGuests(ctx.db, -60_000)
    expect(await guestCount()).toBe(0)

    const second = await post(ACCEPT, { cookie })
    expect(second.statusCode).toBe(201)
    expect((second.json() as DemoBody).tenantId).not.toBe((first.json() as DemoBody).tenantId)
    expect(await guestCount()).toBe(1)
  })

  it("bloque la sixième création de l'heure pour une même IP, puis rouvre après une heure", async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i++) expect((await post(ACCEPT, { ip })).statusCode).toBe(201)
    const guests = await guestCount()

    const sixth = await post(ACCEPT, { ip })
    expect(sixth.statusCode).toBe(429)
    expect(sixth.json()).toEqual({
      error:
        'Trop de démonstrations lancées depuis votre réseau. Réessayez dans une heure, ou créez un compte gratuit.',
      code: 'DEMO_RATE_LIMITED',
    })
    expect(await guestCount()).toBe(guests)
    // Une autre IP n'est pas touchée.
    expect((await post(ACCEPT)).statusCode).toBe(201)

    clock += 3_600_000
    expect((await post(ACCEPT, { ip })).statusCode).toBe(201)
  })

  it('refuse quand le plafond de démonstrations vivantes est atteint, sans créer de compte', async () => {
    const small = await build({ DEMO_ENABLED: 'true', DEMO_MAX_CONCURRENT: '2' })
    await liveGuestSession()
    await liveGuestSession()
    const guests = await guestCount()

    const res = await post(ACCEPT, { target: small })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({
      error:
        'La démonstration est très demandée en ce moment. Créez un compte gratuit pour lancer votre quiz tout de suite.',
      code: 'DEMO_FULL',
    })
    expect(await guestCount()).toBe(guests)

    await ctx.db.execute(sql`delete from "game_session" where pin like '2000%'`)
    await small.close()
  })

  it('tient le budget par IP sous une rafale de créations simultanées, sans erreur 500', async () => {
    const ip = freshIp()
    const before = await guestCount()

    const results = await Promise.all(Array.from({ length: 25 }, () => post(ACCEPT, { ip })))

    const statuses = results.map((r) => r.statusCode)
    expect(statuses.filter((s) => s === 201)).toHaveLength(5)
    expect(statuses.filter((s) => s === 429)).toHaveLength(20)
    expect(await guestCount()).toBe(before + 5)
    // Chaque invité créé a son espace et son quiz : aucun compte orphelin.
    for (const res of results.filter((r) => r.statusCode === 201)) {
      const body = res.json() as DemoBody
      const [quiz] = await ctx.db.select().from(schema.quiz).where(eq(schema.quiz.id, body.quizId))
      expect(quiz?.tenantId).toBe(body.tenantId)
    }
  })

  it("crée sans collision les espaces d'invités venus en même temps d'adresses différentes", async () => {
    const before = await guestCount()
    const results = await Promise.all(Array.from({ length: 12 }, () => post(ACCEPT)))
    expect(results.map((r) => r.statusCode)).toEqual(Array.from({ length: 12 }, () => 201))
    expect(new Set(results.map((r) => (r.json() as DemoBody).tenantId)).size).toBe(12)
    expect(await guestCount()).toBe(before + 12)
  })

  it("ne laisse pas d'invité orphelin quand la copie du quiz échoue", async () => {
    const before = await guestCount()
    const failing = await build({ DEMO_ENABLED: 'true' }, undefined, {
      copyQuiz: async () => {
        throw new Error('copie impossible')
      },
    })
    const res = await post(ACCEPT, { target: failing })
    expect(res.statusCode).toBe(500)
    expect(await guestCount()).toBe(before)
    await failing.close()
  })

  it('refuse une origine étrangère', async () => {
    const res = await post(ACCEPT, { origin: 'https://exemple-tiers.test' })
    expect(res.statusCode).toBe(403)
  })

  it('ne crée rien pour un compte ordinaire connecté', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'deja-la@example.org', password: 'motdepasse-123456', name: 'Hôte', ...ACCEPT },
      headers: JSON_HEADERS,
    })
    expect(signUp.statusCode).toBe(200)
    const guests = await guestCount()

    const res = await post(ACCEPT, { cookie: cookieOf(signUp.headers['set-cookie']) })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: 'Vous êtes déjà connecté : lancez un quiz depuis votre espace.',
      code: 'ALREADY_SIGNED_IN',
    })
    expect(await guestCount()).toBe(guests)
  })
})
