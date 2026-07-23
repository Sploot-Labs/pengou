import type { FastifyInstance } from 'fastify'
import type { Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'

type Deps = { db: Db; config: AppConfig }

// TODO(Plan 4, Task 5) : routes CRUD /api/quizzes/:quizId/questions (protégées, scopées),
// suivant le même pattern que routes/quizzes.ts. Stub no-op pour l'instant afin que
// `registerEditor` reste appelable sans casser le build avant l'implémentation de la Task 5.
export function registerQuestionRoutes(_app: FastifyInstance, _deps: Deps): void {
  // Intentionnellement vide.
}
