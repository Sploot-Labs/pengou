import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createWorkspace, runMigrations, schema, startTestDb, type Db } from '../index.js'
import {
  abandonExpiredGuestSessions,
  countLiveGuestSessions,
  findGuestDemo,
  isGuestUser,
  listDemoDaily,
  purgeExpiredGuests,
  recordDemoLaunched,
  recordDemoStarted,
  setGuestAcceptance,
} from './demo.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let db: Db
let seq = 0

const HOUR = 3_600_000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms)

type Owner = { id: string; tenantId: string }

/** Compte (invité ou non) avec son espace personnel, comme le fait le hook d'inscription en mode multi. */
async function account(opts: { guest: boolean; createdAt?: Date; source?: string | null }): Promise<Owner> {
  const id = `u${++seq}`
  await db.insert(schema.user).values({
    id,
    name: opts.guest ? 'Invité' : `Hôte ${seq}`,
    email: opts.guest ? `temp-${id}@invite.invalid` : `hote${seq}@example.org`,
    isAnonymous: opts.guest,
    signupSource: opts.source ?? null,
    createdAt: opts.createdAt ?? new Date(),
  })
  const workspace = await createWorkspace(db, { name: `Espace ${seq}`, ownerId: id })
  return { id, tenantId: workspace.id }
}

async function quizOf(owner: Owner, title = 'Quiz'): Promise<{ quizId: string; questionId: string }> {
  const [quiz] = await db.insert(schema.quiz).values({ tenantId: owner.tenantId, ownerId: owner.id, title }).returning()
  const [question] = await db
    .insert(schema.question)
    .values({
      quizId: quiz.id,
      tenantId: owner.tenantId,
      type: 'truefalse',
      prompt: 'Vrai ?',
      orderIndex: 0,
      payload: { answer: true },
    })
    .returning()
  return { quizId: quiz.id, questionId: question.id }
}

async function sessionOf(
  owner: Owner,
  quizId: string,
  opts: { status?: 'lobby' | 'active' | 'ended' | 'abandoned'; createdAt?: Date } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.gameSession)
    .values({
      tenantId: owner.tenantId,
      quizId,
      hostId: owner.id,
      pin: String(100000 + ++seq),
      status: opts.status ?? 'lobby',
      createdAt: opts.createdAt ?? new Date(),
      engineState: { demo: true },
    })
    .returning()
  return row.id
}

async function count(table: string): Promise<number> {
  const rows = (await db.execute(sql.raw(`select count(*)::int as n from "${table}"`))) as unknown as Array<{
    n: number
  }>
  return rows[0].n
}

async function sessionRow(id: string) {
  const [row] = await db.select().from(schema.gameSession).where(eq(schema.gameSession.id, id))
  return row
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  db = ctx.db
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

beforeEach(async () => {
  // Chaque test part d'une base sans compte. L'ordre compte : les questions, les joueurs et les
  // réponses référencent le tenant sans cascade.
  for (const table of ['game_session', 'quiz', 'tenant', 'user', 'demo_daily']) {
    await db.execute(sql.raw(`delete from "${table}"`))
  }
})

describe('parties vivantes des invités', () => {
  it("compte les seules parties vivantes d'un hôte invité", async () => {
    const guest = await account({ guest: true })
    const other = await account({ guest: true })
    const host = await account({ guest: false })
    const g = await quizOf(guest)
    const o = await quizOf(other)
    const h = await quizOf(host)
    await sessionOf(guest, g.quizId, { status: 'lobby' })
    await sessionOf(other, o.quizId, { status: 'ended' })
    await sessionOf(host, h.quizId, { status: 'lobby' })

    expect(await countLiveGuestSessions(db)).toBe(1)
  })

  it("retrouve l'espace, le quiz, la partie vivante et la provenance d'un invité", async () => {
    const guest = await account({ guest: true, source: 'accueil' })
    expect(await findGuestDemo(db, guest.id)).toEqual({
      tenantId: guest.tenantId,
      quizId: null,
      liveSessionId: null,
      source: 'accueil',
    })

    const { quizId } = await quizOf(guest)
    await sessionOf(guest, quizId, { status: 'ended' })
    const live = await sessionOf(guest, quizId, { status: 'active' })

    expect(await findGuestDemo(db, guest.id)).toEqual({
      tenantId: guest.tenantId,
      quizId,
      liveSessionId: live,
      source: 'accueil',
    })
  })

  it("distingue un invité d'un compte ordinaire et d'un inconnu", async () => {
    const guest = await account({ guest: true })
    const host = await account({ guest: false })
    expect(await isGuestUser(db, guest.id)).toBe(true)
    expect(await isGuestUser(db, host.id)).toBe(false)
    expect(await isGuestUser(db, 'inconnu')).toBe(false)
  })

  it("enregistre l'acceptation des conditions et la provenance sur le compte invité", async () => {
    const guest = await account({ guest: true })
    const acceptedAt = new Date('2026-11-13T10:00:00Z')
    await setGuestAcceptance(db, guest.id, { termsVersion: '2026-10-31', acceptedAt, source: 'accueil' })
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, guest.id))
    expect(row.termsVersion).toBe('2026-10-31')
    expect(row.termsAcceptedAt?.toISOString()).toBe(acceptedAt.toISOString())
    expect(row.signupSource).toBe('accueil')
  })

  it("abandonne les parties d'invité de plus d'une heure, pas les autres", async () => {
    const guest = await account({ guest: true })
    const host = await account({ guest: false })
    const g = await quizOf(guest)
    const h = await quizOf(host)
    const old = await sessionOf(guest, g.quizId, { status: 'active', createdAt: ago(HOUR + 60_000) })
    const recent = await sessionOf(guest, g.quizId, { status: 'lobby', createdAt: ago(HOUR - 60_000) })
    const ordinary = await sessionOf(host, h.quizId, { status: 'active', createdAt: ago(3 * HOUR) })
    const ended = await sessionOf(guest, g.quizId, { status: 'ended', createdAt: ago(2 * HOUR) })

    expect(await abandonExpiredGuestSessions(db, HOUR)).toEqual([old])

    expect(await sessionRow(old)).toMatchObject({ status: 'abandoned', engineState: null })
    expect((await sessionRow(old)).endedAt).not.toBeNull()
    expect((await sessionRow(recent)).status).toBe('lobby')
    expect((await sessionRow(ordinary)).status).toBe('active')
    expect((await sessionRow(ended)).status).toBe('ended')
  })
})

describe('purge des invités', () => {
  it("supprime l'invité de plus de 24 heures avec son espace, ses quiz, parties, joueurs et réponses", async () => {
    const guest = await account({ guest: true, createdAt: ago(DAY + HOUR) })
    const { quizId, questionId } = await quizOf(guest)
    const sessionId = await sessionOf(guest, quizId, { status: 'ended', createdAt: ago(DAY) })
    const [player] = await db
      .insert(schema.sessionPlayer)
      .values({ sessionId, tenantId: guest.tenantId, nickname: 'Léa', joinToken: 'jeton' })
      .returning()
    await db.insert(schema.answerRecord).values({
      sessionId,
      tenantId: guest.tenantId,
      questionId,
      playerId: player.id,
      answer: { value: true },
      timeMs: 1200,
      isCorrect: true,
    })
    await db.insert(schema.session).values({
      id: 's-invite',
      token: 'jeton-de-session',
      userId: guest.id,
      expiresAt: new Date(Date.now() + DAY),
      updatedAt: new Date(),
    })

    expect(await purgeExpiredGuests(db, DAY)).toBe(1)

    const tables = [
      'user',
      'session',
      'tenant',
      'membership',
      'quiz',
      'question',
      'game_session',
      'session_player',
      'answer_record',
    ]
    for (const table of tables) expect(await count(table), table).toBe(0)
  })

  it("attend la fin de la partie vivante d'un invité de plus de 24 heures avant de le purger", async () => {
    // L'invité de la veille revient sur /demo juste avant ses 24 heures et lance une partie.
    const guest = await account({ guest: true, createdAt: ago(DAY + HOUR) })
    const { quizId } = await quizOf(guest)
    const live = await sessionOf(guest, quizId, { status: 'active' })

    expect(await purgeExpiredGuests(db, DAY)).toBe(0)
    expect(await isGuestUser(db, guest.id)).toBe(true)
    expect((await sessionRow(live)).status).toBe('active')

    await db.update(schema.gameSession).set({ status: 'ended' }).where(eq(schema.gameSession.id, live))
    expect(await purgeExpiredGuests(db, DAY)).toBe(1)
    expect(await isGuestUser(db, guest.id)).toBe(false)
  })

  it('ne purge ni un invité récent ni un compte ordinaire ancien', async () => {
    const recent = await account({ guest: true, createdAt: ago(DAY - HOUR) })
    const host = await account({ guest: false, createdAt: ago(30 * DAY) })
    await quizOf(recent)
    await quizOf(host)

    expect(await purgeExpiredGuests(db, DAY)).toBe(0)

    expect(await count('user')).toBe(2)
    expect(await count('tenant')).toBe(2)
    expect(await count('quiz')).toBe(2)
  })

  it("ne supprime pas un espace qui a un autre membre : l'invité en est seulement retiré", async () => {
    const guest = await account({ guest: true, createdAt: ago(2 * DAY) })
    const host = await account({ guest: false })
    await db.insert(schema.membership).values({ userId: host.id, tenantId: guest.tenantId, role: 'member' })
    const { quizId } = await quizOf(guest, 'Quiz de la démonstration')
    await sessionOf(guest, quizId, { status: 'ended', createdAt: ago(2 * DAY) })
    const [kept] = await db
      .insert(schema.quiz)
      .values({ tenantId: guest.tenantId, ownerId: host.id, title: 'Quiz du membre' })
      .returning()

    expect(await purgeExpiredGuests(db, DAY)).toBe(1)

    expect(await isGuestUser(db, guest.id)).toBe(false)
    expect(await count('tenant')).toBe(2)
    const quizzes = await db.select().from(schema.quiz).where(eq(schema.quiz.tenantId, guest.tenantId))
    expect(quizzes.map((q) => q.id)).toEqual([kept.id])
    expect(await count('game_session')).toBe(0)
  })

  it("ne touche pas à l'espace d'un compte ordinaire dont l'invité serait membre", async () => {
    const guest = await account({ guest: true, createdAt: ago(2 * DAY) })
    const host = await account({ guest: false })
    await db.insert(schema.membership).values({ userId: guest.id, tenantId: host.tenantId, role: 'member' })
    await quizOf(host)

    expect(await purgeExpiredGuests(db, DAY)).toBe(1)

    const tenants = await db.select().from(schema.tenant)
    expect(tenants.map((t) => t.id)).toEqual([host.tenantId])
    expect(await count('quiz')).toBe(1)
  })
})

describe('compteur quotidien des démonstrations', () => {
  it('cumule les lancements et les parties démarrées par jour et par provenance', async () => {
    await recordDemoLaunched(db, '2026-11-13', 'accueil')
    await recordDemoLaunched(db, '2026-11-13', 'accueil')
    await recordDemoStarted(db, '2026-11-13', 'accueil')
    await recordDemoLaunched(db, '2026-11-12', 'direct')
    await recordDemoStarted(db, '2026-11-14', 'enseignants')

    expect(await listDemoDaily(db)).toEqual([
      { day: '2026-11-14', source: 'enseignants', launched: 0, started: 1 },
      { day: '2026-11-13', source: 'accueil', launched: 2, started: 1 },
      { day: '2026-11-12', source: 'direct', launched: 1, started: 0 },
    ])
  })
})
