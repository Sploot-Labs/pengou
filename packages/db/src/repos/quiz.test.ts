import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb } from '../test-helpers.js'
import { runMigrations } from '../migrate.js'
import { schema } from '../index.js'
import { tenantScope } from '../tenant.js'
import { createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz } from './quiz.js'
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
