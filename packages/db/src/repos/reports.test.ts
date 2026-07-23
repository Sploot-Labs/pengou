import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '../index.js'
import { tenantScope } from '../tenant.js'
import { createQuiz } from './quiz.js'
import { createGameSession, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore } from './session.js'
import { listSessions, getSessionReport } from './reports.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string, tenantB: string, ownerA: string
let quizA: string, quizB: string
let q1: string, q2: string, qB: string
let sessionOld: string, sessionRecent: string, sessionB: string
let alice: string, bob: string, carol: string

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)

  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'B' }).returning()
  const [uA] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'host@a.fr', name: 'Host A', emailVerified: false }).returning()
  tenantA = tA.id; tenantB = tB.id; ownerA = uA.id

  const quiz = await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A' })
  quizA = quiz.id
  const quizBRow = await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerA, title: 'Quiz B' })
  quizB = quizBRow.id

  const [question1] = await ctx.db.insert(schema.question).values({
    quizId: quizA, type: 'mcq', prompt: 'Question 1', timeLimit: 20, orderIndex: 0,
    payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
  }).returning()
  q1 = question1.id
  const [question2] = await ctx.db.insert(schema.question).values({
    quizId: quizA, type: 'mcq', prompt: 'Question 2', timeLimit: 20, orderIndex: 1,
    payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
  }).returning()
  q2 = question2.id
  const [questionB] = await ctx.db.insert(schema.question).values({
    quizId: quizB, type: 'mcq', prompt: 'Question B', timeLimit: 20, orderIndex: 0,
    payload: { options: [{ label: 'A', correct: true }] },
  }).returning()
  qB = questionB.id

  // Session ancienne, vide (tenant A) -- teste playerCount = 0 et avgTimeMs = null sans réponses.
  const old = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '100001' })
  sessionOld = old!.id
  await setSessionStatus(ctx.db, sessionOld, 'ended')
  await ctx.db.update(schema.gameSession)
    .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
    .where(eq(schema.gameSession.id, sessionOld))

  // Session récente, peuplée (tenant A).
  const recent = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '100002' })
  sessionRecent = recent!.id
  await ctx.db.update(schema.gameSession)
    .set({ createdAt: new Date('2024-01-01T00:00:00Z') })
    .where(eq(schema.gameSession.id, sessionRecent))

  const alicePlayer = await addSessionPlayer(ctx.db, sessionRecent, { nickname: 'Alice', joinToken: 'tok-alice' })
  const bobPlayer = await addSessionPlayer(ctx.db, sessionRecent, { nickname: 'Bob', joinToken: 'tok-bob' })
  const carolPlayer = await addSessionPlayer(ctx.db, sessionRecent, { nickname: 'Carol', joinToken: 'tok-carol' })
  alice = alicePlayer.id; bob = bobPlayer.id; carol = carolPlayer.id

  // Q1 : 3 réponses, 2 correctes -- temps 3000/5000/8000 -> avg 16000/3 = 5333.33...
  await recordAnswer(ctx.db, { sessionId: sessionRecent, questionId: q1, playerId: alice, answer: { choice: 0 }, timeMs: 3000, isCorrect: true, points: 850 })
  await recordAnswer(ctx.db, { sessionId: sessionRecent, questionId: q1, playerId: bob, answer: { choice: 0 }, timeMs: 5000, isCorrect: true, points: 700 })
  await recordAnswer(ctx.db, { sessionId: sessionRecent, questionId: q1, playerId: carol, answer: { choice: 1 }, timeMs: 8000, isCorrect: false, points: 0 })

  // Q2 : 2 réponses, 1 correcte -- Carol ne répond pas -> avg (2000+6000)/2 = 4000.
  await recordAnswer(ctx.db, { sessionId: sessionRecent, questionId: q2, playerId: alice, answer: { choice: 0 }, timeMs: 2000, isCorrect: true, points: 900 })
  await recordAnswer(ctx.db, { sessionId: sessionRecent, questionId: q2, playerId: bob, answer: { choice: 1 }, timeMs: 6000, isCorrect: false, points: 0 })

  await setPlayerScore(ctx.db, alice, 1750)
  await setPlayerScore(ctx.db, bob, 700)
  await setPlayerScore(ctx.db, carol, 0)
  await setSessionStatus(ctx.db, sessionRecent, 'ended')

  // Tenant B : sa propre session peuplée, doit rester invisible au scope A.
  const bSession = await createGameSession(tenantScope(ctx.db, tenantB), { quizId: quizB, hostId: ownerA, pin: '200001' })
  sessionB = bSession!.id
  const bobB = await addSessionPlayer(ctx.db, sessionB, { nickname: 'BobB', joinToken: 'tok-bobb' })
  await recordAnswer(ctx.db, { sessionId: sessionB, questionId: qB, playerId: bobB.id, answer: { choice: 0 }, timeMs: 1000, isCorrect: true, points: 1000 })
  await setPlayerScore(ctx.db, bobB.id, 1000)
  await setSessionStatus(ctx.db, sessionB, 'ended')
}, 120_000)

afterAll(async () => { await ctx?.stop() })

describe('listSessions', () => {
  it('ne renvoie que les sessions du tenant du scope, plus recentes d’abord', async () => {
    const rows = await listSessions(tenantScope(ctx.db, tenantA))
    expect(rows.map((r) => r.id)).toEqual([sessionRecent, sessionOld])
    expect(rows.some((r) => r.id === sessionB)).toBe(false)
  })

  it('renvoie quizTitle et playerCount corrects', async () => {
    const rows = await listSessions(tenantScope(ctx.db, tenantA))
    const recent = rows.find((r) => r.id === sessionRecent)!
    const old = rows.find((r) => r.id === sessionOld)!
    expect(recent.quizTitle).toBe('Quiz A')
    expect(recent.playerCount).toBe(3)
    expect(recent.quizId).toBe(quizA)
    expect(old.quizTitle).toBe('Quiz A')
    expect(old.playerCount).toBe(0)
  })

  it('scope tenant B ne voit que sa propre session (isolation)', async () => {
    const rows = await listSessions(tenantScope(ctx.db, tenantB))
    expect(rows.map((r) => r.id)).toEqual([sessionB])
  })

  it('respecte opts.limit', async () => {
    const rows = await listSessions(tenantScope(ctx.db, tenantA), { limit: 1 })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(sessionRecent)
  })
})

describe('getSessionReport', () => {
  it('agrege correctement questions et joueurs, joueurs tries par score desc', async () => {
    const report = await getSessionReport(tenantScope(ctx.db, tenantA), sessionRecent)
    expect(report).not.toBeNull()
    expect(report!.session).toMatchObject({
      id: sessionRecent, pin: '100002', status: 'ended', quizId: quizA, quizTitle: 'Quiz A',
    })

    const byId = (id: string) => report!.questions.find((q) => q.questionId === id)!
    const rq1 = byId(q1)
    expect(rq1.answerCount).toBe(3)
    expect(rq1.correctCount).toBe(2)
    expect(rq1.avgTimeMs).toBeCloseTo((3000 + 5000 + 8000) / 3, 1)
    expect(rq1.orderIndex).toBe(0)

    const rq2 = byId(q2)
    expect(rq2.answerCount).toBe(2)
    expect(rq2.correctCount).toBe(1)
    expect(rq2.avgTimeMs).toBeCloseTo((2000 + 6000) / 2, 1)
    expect(rq2.orderIndex).toBe(1)

    expect(report!.players.map((p) => p.nickname)).toEqual(['Alice', 'Bob', 'Carol'])
    const [pAlice, pBob, pCarol] = report!.players
    expect(pAlice).toMatchObject({ nickname: 'Alice', totalScore: 1750, correctCount: 2, answerCount: 2 })
    expect(pBob).toMatchObject({ nickname: 'Bob', totalScore: 700, correctCount: 1, answerCount: 2 })
    expect(pCarol).toMatchObject({ nickname: 'Carol', totalScore: 0, correctCount: 0, answerCount: 1 })
  })

  it('avgTimeMs est null (pas 0) quand une question n’a recu aucune reponse', async () => {
    const report = await getSessionReport(tenantScope(ctx.db, tenantA), sessionOld)
    expect(report).not.toBeNull()
    expect(report!.questions).toHaveLength(2)
    for (const q of report!.questions) {
      expect(q.answerCount).toBe(0)
      expect(q.correctCount).toBe(0)
      expect(q.avgTimeMs).toBeNull()
    }
    expect(report!.players).toEqual([])
  })

  it('renvoie null pour une session d’un autre tenant (pas de fuite, pas d’oracle)', async () => {
    const report = await getSessionReport(tenantScope(ctx.db, tenantA), sessionB)
    expect(report).toBeNull()
  })

  it('renvoie null pour un id de session inexistant', async () => {
    const report = await getSessionReport(tenantScope(ctx.db, tenantA), crypto.randomUUID())
    expect(report).toBeNull()
  })
})
