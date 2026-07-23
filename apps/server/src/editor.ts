import type { FastifyInstance } from 'fastify'
import type { Db } from '@splootlabs/db'
import type { Auth } from '@splootlabs/auth'
import type { AppConfig } from '@splootlabs/shared'
import { registerRequireUser } from './require-user.js'
import { registerQuizRoutes } from './routes/quizzes.js'
import { registerQuestionRoutes } from './routes/questions.js' // Task 5

export function registerEditor(app: FastifyInstance, deps: { db: Db; auth: Auth; config: AppConfig }): void {
  registerRequireUser(app, deps.auth)
  registerQuizRoutes(app, deps)
  registerQuestionRoutes(app, deps) // Task 5
}
