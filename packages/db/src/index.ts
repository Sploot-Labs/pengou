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
  revokePendingInvitationsBy, getInvitationByToken, acceptInvitation, newInvitationToken, invitationExpiry, InvitationError,
  markInvitationEmailed,
  INVITATION_TTL_MS, type Invitation, type InvitationWithWorkspace, type AcceptCode,
} from './repos/invitation.js'
export {
  createQuiz, listQuizzes, getQuiz, updateQuiz, archiveQuiz, restoreQuiz, deleteQuiz, importQuiz, type Quiz, type QuizListItem, type ImportedQuestion,
} from './repos/quiz.js'
export {
  createQuestion, listQuestions, getQuestion, updateQuestion, deleteQuestion, reorderQuestions, type Question,
} from './repos/question.js'
export {
  createGameSession, getGameSessionById, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
  listSessionPlayersByScore, listSessionPlayers,
  saveEngineState, clearEngineState, loadEngineState, loadEngineStateByPin,
  listResumableSessions, abandonStaleSessions, abandonInactiveSessions,
  setWordcloudRemoved, loadWordcloudRemoved,
  type GameSession, type SessionPlayer, type AnswerRecord, type SessionStatus,
} from './repos/session.js'
export {
  listSessions, getSessionReport, type SessionSummary, type SessionReport,
} from './repos/reports.js'
export { syncLibrary, normalizeSearch } from './repos/library-sync.js'
export {
  listLibraryThemes, listLibraryLanguages, searchLibraryQuestions, listLibraryQuizzes,
  drawLibraryQuestions, getLibraryQuestions, getLibraryQuiz,
  type LibraryFilters, type LibraryQuestion, type LibraryQuizSummary,
} from './repos/library.js'
export type { ContentSource } from '@splootlabs/library'
export * as schema from './schema.js'
