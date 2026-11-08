import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '../index.js'
import { tenantScope } from '../tenant.js'
import { createQuiz } from './quiz.js'
import { createQuestion } from './question.js'
import {
  setWordcloudRemoved,
  loadWordcloudRemoved,
  createGameSession,
  getGameSessionById,
  addSessionPlayer,
  recordAnswer,
  setSessionStatus,
  setPlayerScore,
  listSessionPlayersByScore,
  saveEngineState,
  clearEngineState,
  loadEngineState,
  loadEngineStateByPin,
  listResumableSessions,
  abandonStaleSessions,
  abandonInactiveSessions,
} from './session.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string, tenantB: string, ownerA: string, quizA: string, quizB: string, questionA: string

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'B' }).returning()
  const [uA] = await ctx.db
    .insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'a@x.fr', name: 'A', emailVerified: false })
    .returning()
  tenantA = tA.id
  tenantB = tB.id
  ownerA = uA.id
  const q = await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A' })
  quizA = q.id
  const qb = await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerA, title: 'Quiz B' })
  quizB = qb.id
  const [question] = await ctx.db
    .insert(schema.question)
    .values({
      quizId: quizA,
      tenantId: tenantA,
      type: 'mcq',
      prompt: 'Q1',
      timeLimit: 20,
      orderIndex: 0,
      payload: {
        options: [
          { label: 'A', correct: true },
          { label: 'B', correct: false },
        ],
      },
    })
    .returning()
  questionA = question.id
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('repo session scopé au tenant du quiz', () => {
  it('createGameSession crée une session lobby sous le tenant du quiz', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '111111',
    })
    expect(session).not.toBeNull()
    expect(session?.tenantId).toBe(tenantA)
    expect(session?.quizId).toBe(quizA)
    expect(session?.status).toBe('lobby')
  })

  it('createGameSession renvoie null si le quiz appartient à un autre tenant (pas de fuite)', async () => {
    const leaked = await createGameSession(tenantScope(ctx.db, tenantB), {
      quizId: quizA,
      hostId: ownerA,
      pin: '222222',
    })
    expect(leaked).toBeNull()
  })

  it('createGameSession sur un quiz de son propre tenant B fonctionne', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantB), {
      quizId: quizB,
      hostId: ownerA,
      pin: '333333',
    })
    expect(session?.tenantId).toBe(tenantB)
  })

  it('addSessionPlayer ajoute un joueur à la session', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '444444',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Alice', joinToken: 'tok-alice' })
    expect(player.sessionId).toBe(session!.id)
    expect(player.nickname).toBe('Alice')
    expect(player.totalScore).toBe(0)
  })

  it('recordAnswer insère un enregistrement de réponse (jsonb)', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '555555',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Bob', joinToken: 'tok-bob' })
    await recordAnswer(ctx.db, {
      sessionId: session!.id,
      questionId: questionA,
      playerId: player.id,
      answer: { choice: 0 },
      timeMs: 3200,
      isCorrect: true,
      points: 850,
    })
    const [row] = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.playerId, player.id))
    expect(row).toBeDefined()
    expect(row.answer).toEqual({ choice: 0 })
    expect(row.timeMs).toBe(3200)
    expect(row.isCorrect).toBe(true)
    expect(row.points).toBe(850)
  })

  it('recordAnswer est IDEMPOTENT (P1-8) : un 2e appel (session,question,joueur) est un no-op', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '556677',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Idem', joinToken: 'tok-idem' })
    const args = {
      sessionId: session!.id,
      questionId: questionA,
      playerId: player.id,
      answer: { choice: 1 },
      timeMs: 1000,
      isCorrect: false,
      points: 0,
    }
    await recordAnswer(ctx.db, args)
    // Ré-écriture (ex. cicatrisation au redémarrage) : ne doit PAS créer de doublon ni lever.
    await recordAnswer(ctx.db, { ...args, points: 999, answer: { choice: 9 } })
    const rows = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.playerId, player.id))
    expect(rows).toHaveLength(1)
    // La 1re écriture gagne (ON CONFLICT DO NOTHING) : la valeur d'origine est conservée.
    expect(rows[0].points).toBe(0)
    expect(rows[0].answer).toEqual({ choice: 1 })
  })

  it('setSessionStatus met à jour le statut (et startedAt/endedAt)', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '666666',
    })
    await setSessionStatus(ctx.db, session!.id, 'active')
    const [afterStart] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, session!.id))
    expect(afterStart.status).toBe('active')
    expect(afterStart.startedAt).not.toBeNull()

    const at = new Date('2026-01-01T00:00:00.000Z')
    await setSessionStatus(ctx.db, session!.id, 'ended', at)
    const [afterEnd] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, session!.id))
    expect(afterEnd.status).toBe('ended')
    expect(afterEnd.endedAt?.toISOString()).toBe(at.toISOString())
  })

  it('setPlayerScore met à jour total_score', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '777777',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Carol', joinToken: 'tok-carol' })
    await setPlayerScore(ctx.db, player.id, 900)
    const [row] = await ctx.db.select().from(schema.sessionPlayer).where(eq(schema.sessionPlayer.id, player.id))
    expect(row.totalScore).toBe(900)
  })

  it('listSessionPlayersByScore renvoie le classement trié desc par total_score', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '888888',
    })
    const p1 = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Low', joinToken: 't1' })
    const p2 = await addSessionPlayer(ctx.db, session!.id, { nickname: 'High', joinToken: 't2' })
    await setPlayerScore(ctx.db, p1.id, 100)
    await setPlayerScore(ctx.db, p2.id, 900)
    const ranking = await listSessionPlayersByScore(ctx.db, session!.id)
    expect(ranking.map((p) => p.id)).toEqual([p2.id, p1.id])
  })

  it('createGameSession propage la violation Postgres sur un PIN dupliqué parmi les sessions actives', async () => {
    await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '999999' })
    await expect(
      createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '999999' }),
    ).rejects.toThrow()
  })

  it('getGameSessionById renvoie la session par id, hostId inclus', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '112233',
    })
    const found = await getGameSessionById(ctx.db, session!.id)
    expect(found?.id).toBe(session!.id)
    expect(found?.hostId).toBe(ownerA)
  })

  it('getGameSessionById renvoie null pour un id inconnu', async () => {
    const found = await getGameSessionById(ctx.db, crypto.randomUUID())
    expect(found).toBeNull()
  })

  it('createGameSession réutilise un PIN déjà pris par une session ended (index partiel)', async () => {
    const ended = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '000001',
    })
    await setSessionStatus(ctx.db, ended!.id, 'ended')
    const reused = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '000001',
    })
    expect(reused).not.toBeNull()
  })

  it('engine_state : save/load/clear + resumable/stale', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const s = await createGameSession(scope, { quizId: quizA, hostId: ownerA, pin: '900001' })
    await setSessionStatus(ctx.db, s!.id, 'active')
    await saveEngineState(ctx.db, s!.id, { id: s!.id, phase: 'question', answers: { 0: {} } })
    expect(await loadEngineState(ctx.db, s!.id)).toMatchObject({ phase: 'question' })
    expect(await loadEngineStateByPin(ctx.db, '900001')).toMatchObject({ phase: 'question' })
    const resumable = await listResumableSessions(ctx.db, 60_000)
    expect(resumable.map((r) => r.id)).toContain(s!.id)
    await clearEngineState(ctx.db, s!.id)
    expect(await loadEngineState(ctx.db, s!.id)).toBeNull()

    // stale : une session dont created_at est ancien → abandonStaleSessions la bascule vers abandoned.
    const stale = await createGameSession(scope, { quizId: quizA, hostId: ownerA, pin: '900002' })
    await setSessionStatus(ctx.db, stale!.id, 'active')
    await saveEngineState(ctx.db, stale!.id, { id: stale!.id, phase: 'question' })
    await ctx.db.execute(sql`UPDATE game_session SET created_at = now() - interval '2 days' WHERE id = ${stale!.id}`)
    const abandonedIds = await abandonStaleSessions(ctx.db, 3600_000)
    expect(abandonedIds).toContain(stale!.id)
    const [after] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, stale!.id))
    expect(after.status).toBe('abandoned')
    expect(after.engineState).toBeNull()

    // loadEngineStateByPin exclut les sessions non lobby/active : plus de résultat après bascule.
    expect(await loadEngineStateByPin(ctx.db, '900002')).toBeNull()
  })

  it('saveEngineState rafraîchit last_activity_at', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '717171',
    })
    await ctx.db
      .update(schema.gameSession)
      .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(schema.gameSession.id, session!.id))
    await saveEngineState(ctx.db, session!.id, { phase: 'question' })
    const [row] = await ctx.db
      .select({ last: schema.gameSession.lastActivityAt })
      .from(schema.gameSession)
      .where(eq(schema.gameSession.id, session!.id))
    expect(row.last.getTime()).toBeGreaterThan(new Date('2021-01-01T00:00:00Z').getTime())
  })

  it('abandonInactiveSessions bascule les parties inactives vers abandoned et libère le PIN', async () => {
    const s = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '818181' })
    await setSessionStatus(ctx.db, s!.id, 'active')
    await saveEngineState(ctx.db, s!.id, { phase: 'question' })
    await ctx.db
      .update(schema.gameSession)
      .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(schema.gameSession.id, s!.id))

    const ids = await abandonInactiveSessions(ctx.db, 30 * 60_000)
    expect(ids).toContain(s!.id)

    const [row] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, s!.id))
    expect(row.status).toBe('abandoned')
    expect(row.endedAt).not.toBeNull()
    expect(row.engineState).toBeNull()

    // PIN réutilisable : une nouvelle session peut reprendre le même PIN sans violer l'index partiel.
    const reuse = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '818181',
    })
    expect(reuse).not.toBeNull()
  })

  it('abandonInactiveSessions ignore les parties récentes et déjà terminées', async () => {
    const fresh = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '828282',
    })
    await setSessionStatus(ctx.db, fresh!.id, 'active') // last_activity_at = now (défaut/insert récent)
    const ids = await abandonInactiveSessions(ctx.db, 30 * 60_000)
    expect(ids).not.toContain(fresh!.id)
  })

  it('loadEngineStateByPin ignore une ancienne session abandoned et renvoie la nouvelle session live sur le même PIN', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const old = await createGameSession(scope, { quizId: quizA, hostId: ownerA, pin: '838383' })
    await setSessionStatus(ctx.db, old!.id, 'active')
    await saveEngineState(ctx.db, old!.id, { phase: 'question', who: 'old' })
    await ctx.db
      .update(schema.gameSession)
      .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(schema.gameSession.id, old!.id))
    const abandonedIds = await abandonInactiveSessions(ctx.db, 30 * 60_000)
    expect(abandonedIds).toContain(old!.id)

    // Le PIN est libre (index partiel restreint à lobby/active) : une nouvelle session le reprend.
    const fresh = await createGameSession(scope, { quizId: quizA, hostId: ownerA, pin: '838383' })
    expect(fresh).not.toBeNull()
    await setSessionStatus(ctx.db, fresh!.id, 'active')
    await saveEngineState(ctx.db, fresh!.id, { phase: 'question', who: 'fresh' })

    // Sans le filtre lobby/active, la ligne abandoned (engine_state = null) pourrait être
    // retournée à la place de la session live → régression de la Task 3.
    expect(await loadEngineStateByPin(ctx.db, '838383')).toMatchObject({ who: 'fresh' })
  })

  it('addSessionPlayer pose le tenant_id de la session parente (signature inchangée)', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '242424',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Tenanted', joinToken: 'tok-tenanted' })
    expect(player.tenantId).toBe(tenantA)
  })

  it('la FK composite rejette un session_player dont le tenant_id ne colle pas à la session', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '252525',
    })
    await expect(
      ctx.db
        .insert(schema.sessionPlayer)
        .values({
          sessionId: session!.id,
          tenantId: tenantB,
          nickname: 'Cross',
          joinToken: 'tok-cross',
        })
        .returning(),
    ).rejects.toThrow()
  })

  it('recordAnswer pose le tenant_id de la session parente (signature inchangée)', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '262626',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Ans', joinToken: 'tok-ans' })
    await recordAnswer(ctx.db, {
      sessionId: session!.id,
      questionId: questionA,
      playerId: player.id,
      answer: { choice: 0 },
      timeMs: 1000,
      isCorrect: true,
      points: 500,
    })
    const [row] = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.playerId, player.id))
    expect(row.tenantId).toBe(tenantA)
  })

  it('la FK composite rejette un answer_record dont le tenant_id ne colle pas à la session', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '272727',
    })
    const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'X', joinToken: 'tok-x2' })
    await expect(
      ctx.db
        .insert(schema.answerRecord)
        .values({
          sessionId: session!.id,
          tenantId: tenantB,
          questionId: questionA,
          playerId: player.id,
          answer: { choice: 0 } as never,
          timeMs: 1,
          isCorrect: false,
          points: 0,
        })
        .returning(),
    ).rejects.toThrow()
  })
})

describe('nuage de mots', () => {
  it('stocke les mots retirés par question, de façon atomique', async () => {
    const session = await createGameSession(tenantScope(ctx.db, tenantA), {
      quizId: quizA,
      hostId: ownerA,
      pin: '909090',
    })
    const id = session!.id
    expect(await loadWordcloudRemoved(ctx.db, id)).toEqual({})
    await setWordcloudRemoved(ctx.db, id, 'q1', ['cafe'])
    await setWordcloudRemoved(ctx.db, id, 'q2', ['x'])
    expect(await loadWordcloudRemoved(ctx.db, id)).toEqual({ q1: ['cafe'], q2: ['x'] })
    await setWordcloudRemoved(ctx.db, id, 'q1', ['cafe', 'rush'])
    expect(await loadWordcloudRemoved(ctx.db, id)).toEqual({ q1: ['cafe', 'rush'], q2: ['x'] })
  })

  it('accepte une question de type wordcloud', async () => {
    const q = await createQuestion(tenantScope(ctx.db, tenantA), quizA, {
      type: 'wordcloud',
      prompt: 'Un mot ?',
      timeLimit: 30,
      payload: {},
    })
    expect(q?.type).toBe('wordcloud')
  })
})
