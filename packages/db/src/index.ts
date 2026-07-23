export { createDb, type Db } from './client.js'
export { runMigrations } from './migrate.js'
export { startTestDb } from './test-helpers.js'
export {
  tenantScope, type TenantScope, ensureDefaultTenant, resolveTenantId, ensureMembership, DEFAULT_TENANT_NAME,
  TenantAccessDeniedError,
} from './tenant.js'
export {
  createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz, type Quiz,
} from './repos/quiz.js'
export {
  createQuestion, listQuestions, getQuestion, updateQuestion, deleteQuestion, reorderQuestions, type Question,
} from './repos/question.js'
export {
  createGameSession, getGameSessionById, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
  listSessionPlayersByScore,
  type GameSession, type SessionPlayer, type AnswerRecord, type SessionStatus,
} from './repos/session.js'
export * as schema from './schema.js'
