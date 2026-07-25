import { and, eq, sql } from 'drizzle-orm'
import { schema } from '../index.js'
import type { TenantScope } from '../tenant.js'

export type Quiz = typeof schema.quiz.$inferSelect

/** `Quiz` + `questionCount` (Task 6) — a list-only shape, so it does NOT
 * pollute the base `Quiz` type used by `getQuiz`/`createQuiz`/etc. */
export type QuizListItem = Quiz & { questionCount: number }

export async function createQuiz(
  scope: TenantScope,
  input: { ownerId: string; title: string; description?: string },
): Promise<Quiz> {
  const [row] = await scope.db
    .insert(schema.quiz)
    .values({
      tenantId: scope.tenantId, // toujours le tenant du scope, jamais depuis l'input
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? null,
    })
    .returning()
  return row
}

// `questionCount` vient d'un left join agrégé (count) sur `question`, comme
// `playerCount` dans `listSessions` (repos/reports.ts) — un quiz sans
// question renvoie 0 plutôt que d'être exclu de la liste.
export async function listQuizzes(scope: TenantScope): Promise<QuizListItem[]> {
  return scope.db
    .select({
      id: schema.quiz.id,
      tenantId: schema.quiz.tenantId,
      ownerId: schema.quiz.ownerId,
      title: schema.quiz.title,
      description: schema.quiz.description,
      cover: schema.quiz.cover,
      createdAt: schema.quiz.createdAt,
      updatedAt: schema.quiz.updatedAt,
      questionCount: sql<number>`count(${schema.question.id})`.mapWith(Number),
    })
    .from(schema.quiz)
    .leftJoin(schema.question, eq(schema.question.quizId, schema.quiz.id))
    .where(eq(schema.quiz.tenantId, scope.tenantId))
    .groupBy(schema.quiz.id)
}

export async function getQuiz(scope: TenantScope, id: string): Promise<Quiz | null> {
  const [row] = await scope.db
    .select()
    .from(schema.quiz)
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId)))
    .limit(1)
  return row ?? null
}

export async function updateQuiz(scope: TenantScope, id: string, patch: Partial<{ title: string; description: string | null; cover: string | null }>): Promise<Quiz | null> {
  const [row] = await scope.db.update(schema.quiz)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId)))
    .returning()
  return row ?? null
}

export async function deleteQuiz(scope: TenantScope, id: string): Promise<boolean> {
  const rows = await scope.db.delete(schema.quiz)
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId)))
    .returning({ id: schema.quiz.id })
  return rows.length > 0
}
