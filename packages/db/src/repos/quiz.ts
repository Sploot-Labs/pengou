import { and, eq, sql } from 'drizzle-orm'
import { schema, type ContentSource } from '../index.js'
import type { TenantScope } from '../tenant.js'

export type Quiz = typeof schema.quiz.$inferSelect

/**
 * Prédicat d'appartenance au propriétaire, appliqué EN PLUS du filtre tenant dès que le
 * scope porte un `ownerId` (scope utilisateur). Renvoie `undefined` en scope système —
 * `and(...)` de drizzle ignore les conditions `undefined`, donc l'accès reste tenant-large.
 * Ferme la faille P0 d'accès intra-tenant : sans ce filtre, tout membre du tenant pouvait
 * lister/lire/modifier/supprimer les quiz d'autrui.
 */
function ownerPredicate(scope: TenantScope) {
  return scope.ownerId ? eq(schema.quiz.ownerId, scope.ownerId) : undefined
}

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
      source: schema.quiz.source,
      createdAt: schema.quiz.createdAt,
      updatedAt: schema.quiz.updatedAt,
      questionCount: sql<number>`count(${schema.question.id})`.mapWith(Number),
    })
    .from(schema.quiz)
    .leftJoin(schema.question, eq(schema.question.quizId, schema.quiz.id))
    .where(and(eq(schema.quiz.tenantId, scope.tenantId), ownerPredicate(scope)))
    .groupBy(schema.quiz.id)
}

export async function getQuiz(scope: TenantScope, id: string): Promise<Quiz | null> {
  const [row] = await scope.db
    .select()
    .from(schema.quiz)
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId), ownerPredicate(scope)))
    .limit(1)
  return row ?? null
}

export async function updateQuiz(scope: TenantScope, id: string, patch: Partial<{ title: string; description: string | null; cover: string | null }>): Promise<Quiz | null> {
  const [row] = await scope.db.update(schema.quiz)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId), ownerPredicate(scope)))
    .returning()
  return row ?? null
}

export async function deleteQuiz(scope: TenantScope, id: string): Promise<boolean> {
  const rows = await scope.db.delete(schema.quiz)
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId), ownerPredicate(scope)))
    .returning({ id: schema.quiz.id })
  return rows.length > 0
}

export type ImportedQuestion = {
  type: typeof schema.question.$inferSelect['type']
  prompt: string
  payload: unknown
  timeLimit: number
  readingTime: number
  source: ContentSource | null
}

/** Crée un quiz et ses questions (copie d'une source externe) dans le scope courant. Sans
 * transaction interne : l'appelant est dans `withTenantTx`. */
export async function importQuiz(
  scope: TenantScope,
  input: {
    ownerId: string
    title: string
    description?: string | null
    source: ContentSource | null
    questions: ImportedQuestion[]
  },
): Promise<Quiz> {
  const [row] = await scope.db
    .insert(schema.quiz)
    .values({
      tenantId: scope.tenantId,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? null,
      source: input.source,
    })
    .returning()
  if (input.questions.length > 0) {
    await scope.db.insert(schema.question).values(input.questions.map((q, orderIndex) => ({
      quizId: row.id,
      tenantId: scope.tenantId,
      type: q.type,
      prompt: q.prompt,
      timeLimit: q.timeLimit,
      readingTime: q.readingTime,
      payload: q.payload as never,
      media: null,
      source: q.source,
      orderIndex,
    })))
  }
  return row
}
