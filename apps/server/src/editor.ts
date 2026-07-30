import type { FastifyInstance } from 'fastify'
import type { Db } from '@splootlabs/db'
import type { Auth } from '@splootlabs/auth'
import type { AppConfig } from '@splootlabs/shared'
import { registerRequireUser } from './require-user.js'
import { registerQuizRoutes } from './routes/quizzes.js'
import { registerQuestionRoutes } from './routes/questions.js' // Task 5
import { registerReportRoutes } from './routes/sessions.js'

export function registerEditor(
  app: FastifyInstance,
  deps: { systemDb: Db; appDb: Db; auth: Auth; config: AppConfig },
): void {
  registerRequireUser(app, deps.auth)
  const routeDeps = { systemDb: deps.systemDb, appDb: deps.appDb, config: deps.config }
  registerQuizRoutes(app, routeDeps)
  registerQuestionRoutes(app, routeDeps) // Task 5
  registerReportRoutes(app, routeDeps)
}
