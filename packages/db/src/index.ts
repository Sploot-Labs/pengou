export { createDb, createAppDb, deriveAppUrl, pingDb, type Db } from './client.js'
export { runMigrations } from './migrate.js'
export { startTestDb } from './test-helpers.js'
export { ensureAppRole, setAppRolePassword } from './role-provisioning.js'
export {
  tenantScope, type TenantScope, ensureDefaultTenant, resolveTenantId, ensureMembership, DEFAULT_TENANT_NAME,
  TenantAccessDeniedError, getMembershipRole, scopeForUser, firstMembershipRole, withTenantTx,
} from './tenant.js'
export {
  slugify, generateUniqueSlug, createWorkspace, listUserWorkspaces, getWorkspaceBySlug, isMember,
  listMembers, getMemberRole, countOwners, setMemberRole, removeMember,
  type Workspace, type UserWorkspace, type Member,
} from './workspace.js'
export {
  createInvitation, listInvitations, getInvitationById, revokeInvitation, resendInvitation,
  getInvitationByToken, acceptInvitation, newInvitationToken, invitationExpiry, InvitationError,
  INVITATION_TTL_MS, type Invitation, type InvitationWithWorkspace, type AcceptCode,
} from './repos/invitation.js'
export {
  createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz, type Quiz, type QuizListItem,
} from './repos/quiz.js'
export {
  createQuestion, listQuestions, getQuestion, updateQuestion, deleteQuestion, reorderQuestions, type Question,
} from './repos/question.js'
export {
  createGameSession, getGameSessionById, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
  listSessionPlayersByScore, listSessionPlayers, deleteSessionPlayer,
  saveEngineState, clearEngineState, loadEngineState, loadEngineStateByPin,
  listResumableSessions, abandonStaleSessions, abandonInactiveSessions,
  type GameSession, type SessionPlayer, type AnswerRecord, type SessionStatus,
} from './repos/session.js'
export {
  listSessions, getSessionReport, type SessionSummary, type SessionReport,
} from './repos/reports.js'
export * as schema from './schema.js'
