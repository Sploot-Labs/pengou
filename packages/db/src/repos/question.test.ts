import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations, schema } from '../index.js'
import { tenantScope } from '../tenant.js'
import { createQuiz } from './quiz.js'
import { createQuestion, listQuestions, getQuestion, updateQuestion, deleteQuestion, reorderQuestions } from './question.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string, tenantB: string, ownerA: string, ownerB: string, quizA: string

beforeAll(async () => {
  ctx = await startTestDb(); await runMigrations(ctx.db)
  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'B' }).returning()
  const [uA] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'a@x.fr', name: 'A', emailVerified: false }).returning()
  const [uB] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'b@x.fr', name: 'B', emailVerified: false }).returning()
  tenantA = tA.id; tenantB = tB.id; ownerA = uA.id; ownerB = uB.id
  const q = await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A' })
  quizA = q.id
}, 120_000)
afterAll(async () => { await ctx?.stop() })

const validMcq = { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] }

describe('repo question scopé par jointure sur quiz', () => {
  it('createQuestion écrit sous un quiz du tenant', async () => {
    const q = await createQuestion(tenantScope(ctx.db, tenantA), quizA, { type: 'mcq', prompt: 'Q1', timeLimit: 20, payload: validMcq })
    expect(q?.quizId).toBe(quizA)
  })
  it('createQuestion renvoie null si le quiz appartient à un autre tenant (pas de fuite)', async () => {
    const leaked = await createQuestion(tenantScope(ctx.db, tenantB), quizA, { type: 'mcq', prompt: 'X', timeLimit: 20, payload: validMcq })
    expect(leaked).toBeNull()
  })
  it('listQuestions renvoie null pour un quiz d\'un autre tenant', async () => {
    expect(await listQuestions(tenantScope(ctx.db, tenantB), quizA)).toBeNull()
    const own = await listQuestions(tenantScope(ctx.db, tenantA), quizA)
    expect(Array.isArray(own)).toBe(true)
  })

  it('getQuestion renvoie la question du quiz du tenant', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const created = await createQuestion(scope, quizA, { type: 'mcq', prompt: 'GetMe', timeLimit: 20, payload: validMcq })
    const fetched = await getQuestion(scope, quizA, created!.id)
    expect(fetched?.id).toBe(created!.id)
    expect(fetched?.type).toBe('mcq')
  })

  it('getQuestion renvoie null si le quiz appartient à un autre tenant (pas de fuite)', async () => {
    const created = await createQuestion(tenantScope(ctx.db, tenantA), quizA, { type: 'mcq', prompt: 'Hidden', timeLimit: 20, payload: validMcq })
    const leaked = await getQuestion(tenantScope(ctx.db, tenantB), quizA, created!.id)
    expect(leaked).toBeNull()
  })

  it('getQuestion renvoie null pour un questionId inexistant', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    expect(await getQuestion(scope, quizA, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('createQuestion incrémente orderIndex automatiquement', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const q = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Order' })
    const q1 = await createQuestion(scope, q.id, { type: 'mcq', prompt: 'O1', timeLimit: 20, payload: validMcq })
    const q2 = await createQuestion(scope, q.id, { type: 'mcq', prompt: 'O2', timeLimit: 20, payload: validMcq })
    expect(q1?.orderIndex).toBe(0)
    expect(q2?.orderIndex).toBe(1)
  })

  it('updateQuestion modifie une question du quiz du tenant', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const created = await createQuestion(scope, quizA, { type: 'mcq', prompt: 'Before', timeLimit: 20, payload: validMcq })
    const updated = await updateQuestion(scope, quizA, created!.id, { prompt: 'After' })
    expect(updated?.prompt).toBe('After')
  })

  it('updateQuestion renvoie null si le quiz appartient à un autre tenant (pas de fuite)', async () => {
    const created = await createQuestion(tenantScope(ctx.db, tenantA), quizA, { type: 'mcq', prompt: 'Guard', timeLimit: 20, payload: validMcq })
    const result = await updateQuestion(tenantScope(ctx.db, tenantB), quizA, created!.id, { prompt: 'Hacked' })
    expect(result).toBeNull()
    const untouched = await listQuestions(tenantScope(ctx.db, tenantA), quizA)
    expect(untouched?.find((q) => q.id === created!.id)?.prompt).toBe('Guard')
  })

  it('updateQuestion avec un patch vide est un no-op qui renvoie la ligne courante (pas de 500 drizzle)', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const created = await createQuestion(scope, quizA, { type: 'mcq', prompt: 'Unchanged', timeLimit: 20, payload: validMcq })
    const result = await updateQuestion(scope, quizA, created!.id, {})
    expect(result).not.toBeNull()
    expect(result?.id).toBe(created!.id)
    expect(result?.prompt).toBe('Unchanged')
  })

  it('deleteQuestion supprime une question du quiz du tenant', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const created = await createQuestion(scope, quizA, { type: 'mcq', prompt: 'ToDelete', timeLimit: 20, payload: validMcq })
    const ok = await deleteQuestion(scope, quizA, created!.id)
    expect(ok).toBe(true)
    const remaining = await listQuestions(scope, quizA)
    expect(remaining?.some((q) => q.id === created!.id)).toBe(false)
  })

  it('deleteQuestion renvoie false si le quiz appartient à un autre tenant (pas de fuite)', async () => {
    const created = await createQuestion(tenantScope(ctx.db, tenantA), quizA, { type: 'mcq', prompt: 'Survive', timeLimit: 20, payload: validMcq })
    const ok = await deleteQuestion(tenantScope(ctx.db, tenantB), quizA, created!.id)
    expect(ok).toBe(false)
    const remaining = await listQuestions(tenantScope(ctx.db, tenantA), quizA)
    expect(remaining?.some((q) => q.id === created!.id)).toBe(true)
  })

  it('reorderQuestions réordonne les questions du quiz du tenant (transactionnel)', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quiz = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Reorder' })
    const q1 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'R1', timeLimit: 20, payload: validMcq })
    const q2 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'R2', timeLimit: 20, payload: validMcq })
    const ok = await reorderQuestions(scope, quiz.id, [q2!.id, q1!.id])
    expect(ok).toBe(true)
    const list = await listQuestions(scope, quiz.id)
    expect(list?.map((q) => q.id)).toEqual([q2!.id, q1!.id])
  })

  it('reorderQuestions renvoie false si le quiz appartient à un autre tenant (pas de fuite)', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quiz = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Reorder Guard' })
    const q1 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'G1', timeLimit: 20, payload: validMcq })
    const q2 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'G2', timeLimit: 20, payload: validMcq })
    const ok = await reorderQuestions(tenantScope(ctx.db, tenantB), quiz.id, [q2!.id, q1!.id])
    expect(ok).toBe(false)
    const list = await listQuestions(scope, quiz.id)
    expect(list?.map((q) => q.id)).toEqual([q1!.id, q2!.id])
  })

  it('reorderQuestions renvoie false et ne touche pas un autre quiz du même tenant (id empoisonné)', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quizA2 = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz A2 sibling' })
    const foreign = await createQuestion(scope, quizA2.id, { type: 'mcq', prompt: 'Foreign', timeLimit: 20, payload: validMcq })
    const foreignOrderIndexBefore = foreign!.orderIndex

    const ok = await reorderQuestions(scope, quizA, [foreign!.id])
    expect(ok).toBe(false)

    const foreignAfter = await listQuestions(scope, quizA2.id)
    const untouched = foreignAfter?.find((q) => q.id === foreign!.id)
    expect(untouched?.orderIndex).toBe(foreignOrderIndexBefore)
  })

  it('reorderQuestions rejette une liste avec des doublons ([a, a]) — pas une permutation exacte', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quiz = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Reorder Dup' })
    const q1 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'D1', timeLimit: 20, payload: validMcq })
    await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'D2', timeLimit: 20, payload: validMcq })

    const ok = await reorderQuestions(scope, quiz.id, [q1!.id, q1!.id])
    expect(ok).toBe(false)

    const list = await listQuestions(scope, quiz.id)
    expect(list?.map((q) => q.prompt)).toEqual(['D1', 'D2']) // ordre inchangé
  })

  it('reorderQuestions rejette une liste partielle (questions omises) — orderIndex non touché', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quiz = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Reorder Partial' })
    const q1 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'P1', timeLimit: 20, payload: validMcq })
    const q2 = await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'P2', timeLimit: 20, payload: validMcq })

    const ok = await reorderQuestions(scope, quiz.id, [q2!.id])
    expect(ok).toBe(false)

    const list = await listQuestions(scope, quiz.id)
    expect(list?.map((q) => q.id)).toEqual([q1!.id, q2!.id])
  })

  it('reorderQuestions rejette une liste vide sur un quiz non vide', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quiz = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Reorder Empty List' })
    await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'E1', timeLimit: 20, payload: validMcq })

    const ok = await reorderQuestions(scope, quiz.id, [])
    expect(ok).toBe(false)
  })

  it('reorderQuestions accepte une liste vide sur un quiz sans question (permutation vide valide)', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const quiz = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz Reorder No Question' })
    const ok = await reorderQuestions(scope, quiz.id, [])
    expect(ok).toBe(true)
  })
})
