import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb } from '../test-helpers.js'
import { runMigrations } from '../migrate.js'
import { schema } from '../index.js'
import { tenantScope, withTenantTx } from '../tenant.js'
import { createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz, importQuiz } from './quiz.js'
import { createQuestion } from './question.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string
let tenantB: string
let ownerA: string
let ownerB: string

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'Tenant A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'Tenant B' }).returning()
  const [uA] = await ctx.db
    .insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'a@x.fr', name: 'Owner A', emailVerified: false })
    .returning()
  const [uB] = await ctx.db
    .insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'b@x.fr', name: 'Owner B', emailVerified: false })
    .returning()
  tenantA = tA.id
  tenantB = tB.id
  ownerA = uA.id
  ownerB = uB.id
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('repo quiz scoped par tenant', () => {
  it('createQuiz écrit le tenant_id du scope', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const q = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz A1' })
    expect(q.tenantId).toBe(tenantA)
  })

  it('listQuizzes ne renvoie que les quiz du tenant du scope', async () => {
    await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B1' })
    const listA = await listQuizzes(tenantScope(ctx.db, tenantA))
    const listB = await listQuizzes(tenantScope(ctx.db, tenantB))
    expect(listA.every((q) => q.tenantId === tenantA)).toBe(true)
    expect(listB.every((q) => q.tenantId === tenantB)).toBe(true)
    expect(listA.some((q) => q.title === 'Quiz B1')).toBe(false)
  })

  it("getQuiz renvoie null pour un quiz d'un autre tenant (pas de fuite)", async () => {
    const qb = await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B2' })
    const leaked = await getQuiz(tenantScope(ctx.db, tenantA), qb.id)
    expect(leaked).toBeNull()
  })

  it('updateQuiz modifie un quiz du tenant du scope', async () => {
    const q = await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A2' })
    const updated = await updateQuiz(tenantScope(ctx.db, tenantA), q.id, { title: 'Quiz A2 modifié' })
    expect(updated?.title).toBe('Quiz A2 modifié')
  })

  it("updateQuiz renvoie null pour un quiz d'un autre tenant (pas de fuite)", async () => {
    const qb = await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B3' })
    const result = await updateQuiz(tenantScope(ctx.db, tenantA), qb.id, { title: 'hack' })
    expect(result).toBeNull()
    const untouched = await getQuiz(tenantScope(ctx.db, tenantB), qb.id)
    expect(untouched?.title).toBe('Quiz B3')
  })

  it('deleteQuiz supprime un quiz du tenant du scope', async () => {
    const q = await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A3' })
    const ok = await deleteQuiz(tenantScope(ctx.db, tenantA), q.id)
    expect(ok).toBe(true)
    expect(await getQuiz(tenantScope(ctx.db, tenantA), q.id)).toBeNull()
  })

  it("deleteQuiz renvoie false pour un quiz d'un autre tenant (pas de fuite)", async () => {
    const qb = await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B4' })
    const ok = await deleteQuiz(tenantScope(ctx.db, tenantA), qb.id)
    expect(ok).toBe(false)
    expect(await getQuiz(tenantScope(ctx.db, tenantB), qb.id)).not.toBeNull()
  })

  it('listQuizzes expose questionCount (N questions, et 0 sans question)', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const withQuestions = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz avec questions' })
    const withoutQuestions = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz sans question' })
    const validMcq = {
      options: [
        { label: 'A', correct: true },
        { label: 'B', correct: false },
      ],
    }
    await createQuestion(scope, withQuestions.id, { type: 'mcq', prompt: 'Q1', timeLimit: 20, payload: validMcq })
    await createQuestion(scope, withQuestions.id, { type: 'mcq', prompt: 'Q2', timeLimit: 20, payload: validMcq })
    await createQuestion(scope, withQuestions.id, { type: 'mcq', prompt: 'Q3', timeLimit: 20, payload: validMcq })

    const list = await listQuizzes(scope)
    const found = list.find((q) => q.id === withQuestions.id)
    const foundEmpty = list.find((q) => q.id === withoutQuestions.id)
    expect(found?.questionCount).toBe(3)
    expect(foundEmpty?.questionCount).toBe(0)
  })
})

describe('importQuiz', () => {
  const src = { name: 'Test', license: 'CC0' }
  const questions = [
    {
      type: 'truefalse' as const,
      prompt: 'Première ?',
      payload: { answer: true },
      timeLimit: 20,
      readingTime: 6,
      source: src,
    },
    {
      type: 'truefalse' as const,
      prompt: 'Seconde ?',
      payload: { answer: false },
      timeLimit: 15,
      readingTime: 4,
      source: null,
    },
  ]

  it("importQuiz crée le quiz et ses questions dans l'ordre, avec leurs sources", async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const created = await importQuiz(scope, {
      ownerId: ownerA,
      title: 'Importé',
      description: 'D',
      source: src,
      questions,
    })
    expect(created).toMatchObject({
      tenantId: tenantA,
      ownerId: ownerA,
      title: 'Importé',
      description: 'D',
      source: src,
    })
    const rows = await ctx.db
      .select()
      .from(schema.question)
      .where(eq(schema.question.quizId, created.id))
      .orderBy(schema.question.orderIndex)
    expect(rows.map((r) => [r.prompt, r.orderIndex, r.source, r.media, r.tenantId])).toEqual([
      ['Première ?', 0, src, null, tenantA],
      ['Seconde ?', 1, null, null, tenantA],
    ])
    expect(rows[1]).toMatchObject({ timeLimit: 15, readingTime: 4 })
  })

  it('importQuiz sans question crée seulement le quiz', async () => {
    const created = await importQuiz(tenantScope(ctx.db, tenantA), {
      ownerId: ownerA,
      title: 'Vide',
      source: null,
      questions: [],
    })
    expect(created.description).toBeNull()
    expect(created.source).toBeNull()
  })

  it('importQuiz sous appDb et withTenantTx respecte la RLS', async () => {
    const created = await withTenantTx(ctx.appDb, { tenantId: tenantA, ownerId: ownerA }, (scope) =>
      importQuiz(scope, { ownerId: ownerA, title: 'Sous RLS', source: src, questions }),
    )
    const seenB = await withTenantTx(ctx.appDb, { tenantId: tenantB }, (scope) => listQuizzes(scope))
    expect(seenB.some((z) => z.id === created.id)).toBe(false)
    const seenA = await withTenantTx(ctx.appDb, { tenantId: tenantA }, (scope) => listQuizzes(scope))
    expect(seenA.find((z) => z.id === created.id)).toMatchObject({ source: src, questionCount: 2 })
  })

  it('listQuizzes expose source', async () => {
    const list = await listQuizzes(tenantScope(ctx.db, tenantA))
    expect(list.find((z) => z.title === 'Importé')?.source).toEqual(src)
    expect(list.find((z) => z.title === 'Quiz A1')?.source).toBeNull()
  })
})
