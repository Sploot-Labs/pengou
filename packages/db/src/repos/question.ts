import { and, eq, sql } from 'drizzle-orm'
import { schema } from '../index.js'
import type { TenantScope } from '../tenant.js'
import { getQuiz } from './quiz.js'

export type Question = typeof schema.question.$inferSelect

type CreateInput = {
  type: 'mcq' | 'truefalse' | 'text' | 'slider' | 'wordcloud' | 'poll'
  prompt: string
  timeLimit: number
  readingTime?: number
  payload: unknown
  media?: string | null
  mediaAlt?: string | null
  orderIndex?: number
}

// Garde-fou multi-tenant : le quiz parent DOIT appartenir au tenant du scope.
async function assertQuizInTenant(scope: TenantScope, quizId: string): Promise<boolean> {
  return (await getQuiz(scope, quizId)) !== null
}

export async function createQuestion(scope: TenantScope, quizId: string, input: CreateInput): Promise<Question | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  const orderIndex = input.orderIndex ?? (await nextOrderIndex(scope, quizId))
  const [row] = await scope.db
    .insert(schema.question)
    .values({
      quizId,
      tenantId: scope.tenantId,
      type: input.type,
      prompt: input.prompt,
      timeLimit: input.timeLimit,
      readingTime: input.readingTime ?? 6,
      payload: input.payload as never,
      media: input.media ?? null,
      mediaAlt: input.mediaAlt ?? null,
      orderIndex,
    })
    .returning()
  return row
}

export async function listQuestions(scope: TenantScope, quizId: string): Promise<Question[] | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  return scope.db
    .select()
    .from(schema.question)
    .where(and(eq(schema.question.quizId, quizId), eq(schema.question.tenantId, scope.tenantId)))
    .orderBy(schema.question.orderIndex)
}

export async function getQuestion(scope: TenantScope, quizId: string, questionId: string): Promise<Question | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  const [row] = await scope.db
    .select()
    .from(schema.question)
    .where(
      and(
        eq(schema.question.id, questionId),
        eq(schema.question.quizId, quizId),
        eq(schema.question.tenantId, scope.tenantId),
      ),
    )
  return row ?? null
}

export async function updateQuestion(
  scope: TenantScope,
  quizId: string,
  questionId: string,
  patch: Partial<{
    prompt: string
    timeLimit: number
    readingTime: number
    payload: unknown
    media: string | null
    mediaAlt: string | null
  }>,
): Promise<Question | null> {
  if (!(await assertQuizInTenant(scope, quizId))) return null
  // Patch vide : `.set({})` fait échouer drizzle ("No values to set") — un patch vide est un
  // no-op légitime (ex. PATCH sans corps utile), pas une erreur serveur. On renvoie simplement
  // la ligne courante, sans écriture, plutôt que de laisser drizzle lever une 500 non gérée.
  if (Object.keys(patch).length === 0) {
    return getQuestion(scope, quizId, questionId)
  }
  const [row] = await scope.db
    .update(schema.question)
    .set({ ...patch, payload: patch.payload as never })
    .where(and(eq(schema.question.id, questionId), eq(schema.question.quizId, quizId)))
    .returning()
  return row ?? null
}

export async function deleteQuestion(scope: TenantScope, quizId: string, questionId: string): Promise<boolean> {
  if (!(await assertQuizInTenant(scope, quizId))) return false
  const rows = await scope.db
    .delete(schema.question)
    .where(and(eq(schema.question.id, questionId), eq(schema.question.quizId, quizId)))
    .returning({ id: schema.question.id })
  return rows.length > 0
}

export async function reorderQuestions(scope: TenantScope, quizId: string, orderedIds: string[]): Promise<boolean> {
  if (!(await assertQuizInTenant(scope, quizId))) return false

  // `orderedIds` DOIT être une permutation EXACTE des questions du quiz — sans ça,
  // `matched === orderedIds.length` (l'ancienne garde) laissait passer des doublons
  // (ex. [a, a] : 2 updates, 2 lignes affectées, "count===length" alors qu'une seule question a
  // réellement bougé) et des listes partielles (les questions omises gardent un orderIndex
  // périmé, incohérent avec celles ré-indexées). On vérifie donc l'ENSEMBLE avant toute écriture.
  const existing = await scope.db
    .select({ id: schema.question.id })
    .from(schema.question)
    .where(eq(schema.question.quizId, quizId))
  const existingIds = new Set(existing.map((q) => q.id))
  const uniqueOrderedIds = new Set(orderedIds)
  const isExactPermutation =
    uniqueOrderedIds.size === orderedIds.length &&
    uniqueOrderedIds.size === existingIds.size &&
    orderedIds.every((id) => existingIds.has(id))
  if (!isExactPermutation) return false

  const matched = await scope.db.transaction(async (tx) => {
    let count = 0
    for (let i = 0; i < orderedIds.length; i++) {
      const rows = await tx
        .update(schema.question)
        .set({ orderIndex: i })
        .where(and(eq(schema.question.id, orderedIds[i]), eq(schema.question.quizId, quizId)))
        .returning({ id: schema.question.id })
      count += rows.length
    }
    return count
  })
  return matched === orderedIds.length
}

async function nextOrderIndex(scope: TenantScope, quizId: string): Promise<number> {
  const [row] = await scope.db
    .select({ max: sql<number>`coalesce(max(${schema.question.orderIndex}), -1)` })
    .from(schema.question)
    .where(eq(schema.question.quizId, quizId))
  return (row?.max ?? -1) + 1
}
