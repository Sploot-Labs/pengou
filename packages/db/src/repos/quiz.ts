import { and, eq } from 'drizzle-orm'
import { schema } from '../index.js'
import type { TenantScope } from '../tenant.js'

export type Quiz = typeof schema.quiz.$inferSelect

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

export async function listQuizzes(scope: TenantScope): Promise<Quiz[]> {
  return scope.db.select().from(schema.quiz).where(eq(schema.quiz.tenantId, scope.tenantId))
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
