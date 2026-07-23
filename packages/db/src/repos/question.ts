import { and, eq, sql } from 'drizzle-orm'
import { schema } from '../index.js'
import type { TenantScope } from '../tenant.js'
import { getQuiz } from './quiz.js'

export type Question = typeof schema.question.$inferSelect

type CreateInput = { type: 'mcq' | 'truefalse' | 'text' | 'slider'; prompt: string; timeLimit: number; payload: unknown; media?: string | null; orderIndex?: number }

// Garde-fou multi-tenant : le quiz parent DOIT appartenir au tenant du scope.
async function assertQuizInTenant(scope: TenantScope, quizId: string): Promise<boolean> {
  return (await getQuiz(scope, quizId)) !== null
}

export async function createQuestion(scope: TenantScope, quizId: string, input: CreateInput): Promise<Question | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  const orderIndex = input.orderIndex ?? (await nextOrderIndex(scope, quizId))
  const [row] = await scope.db.insert(schema.question).values({
    quizId, type: input.type, prompt: input.prompt, timeLimit: input.timeLimit,
    payload: input.payload as never, media: input.media ?? null, orderIndex,
  }).returning()
  return row
}

export async function listQuestions(scope: TenantScope, quizId: string): Promise<Question[] | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  return scope.db.select().from(schema.question)
    .where(eq(schema.question.quizId, quizId))
    .orderBy(schema.question.orderIndex)
}

export async function getQuestion(scope: TenantScope, quizId: string, questionId: string): Promise<Question | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  const [row] = await scope.db.select().from(schema.question)
    .where(and(eq(schema.question.id, questionId), eq(schema.question.quizId, quizId)))
  return row ?? null
}

export async function updateQuestion(scope: TenantScope, quizId: string, questionId: string, patch: Partial<{ prompt: string; timeLimit: number; payload: unknown; media: string | null }>): Promise<Question | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  const [row] = await scope.db.update(schema.question)
    .set({ ...patch, payload: patch.payload as never })
    .where(and(eq(schema.question.id, questionId), eq(schema.question.quizId, quizId)))
    .returning()
  return row ?? null
}

export async function deleteQuestion(scope: TenantScope, quizId: string, questionId: string): Promise<boolean> {
  if (!(await assertQuizInTenant(scope, quizId))) return false
  const rows = await scope.db.delete(schema.question)
    .where(and(eq(schema.question.id, questionId), eq(schema.question.quizId, quizId)))
    .returning({ id: schema.question.id })
  return rows.length > 0
}

export async function reorderQuestions(scope: TenantScope, quizId: string, orderedIds: string[]): Promise<boolean> {
  if (!(await assertQuizInTenant(scope, quizId))) return false
  const matched = await scope.db.transaction(async (tx) => {
    let count = 0
    for (let i = 0; i < orderedIds.length; i++) {
      const rows = await tx.update(schema.question).set({ orderIndex: i })
        .where(and(eq(schema.question.id, orderedIds[i]), eq(schema.question.quizId, quizId)))
        .returning({ id: schema.question.id })
      count += rows.length
    }
    return count
  })
  return matched === orderedIds.length
}

async function nextOrderIndex(scope: TenantScope, quizId: string): Promise<number> {
  const [row] = await scope.db.select({ max: sql<number>`coalesce(max(${schema.question.orderIndex}), -1)` })
    .from(schema.question).where(eq(schema.question.quizId, quizId))
  return (row?.max ?? -1) + 1
}
