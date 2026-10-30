import { sql } from 'drizzle-orm'
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index, foreignKey, primaryKey,
} from 'drizzle-orm/pg-core'
import type { ContentSource } from '@splootlabs/library'
import { user } from './auth-schema.js'

export const planEnum = pgEnum('plan', ['free', 'pro'])
export const roleEnum = pgEnum('role', ['owner', 'admin', 'member'])
export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'revoked'])
export const questionTypeEnum = pgEnum('question_type', ['mcq', 'truefalse', 'text', 'slider'])
export const libraryDifficultyEnum = pgEnum('library_difficulty', ['facile', 'moyen', 'difficile'])
export const libraryAudienceEnum = pgEnum('library_audience', ['enfants', 'adultes', 'tous'])
export const libraryOriginEnum = pgEnum('library_origin', ['builtin', 'instance'])
export const sessionStatusEnum = pgEnum('session_status', ['lobby', 'active', 'ended', 'abandoned'])

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // Slice 3 : `name` n'est PLUS unique globalement (deux orgs « Acme » sont légitimes) — l'ancien
  // `tenant_name_unique` est retiré par la migration. `slug` est l'identifiant humain STABLE et
  // unique global (URL-safe, dérivé du nom avec désambiguïsation). `id` (uuid) reste la valeur
  // portée par `x-tenant-id` et le GUC RLS `app.tenant_id`.
  name: text('name').notNull(),
  // Défaut aléatoire = filet : tout insert qui omet `slug` (tests, chemins bas niveau) reste
  // valide et unique. `createWorkspace` fournit un slug LISIBLE dérivé du nom ; `ensureDefaultTenant`
  // force `default`.
  slug: text('slug').notNull().unique().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  plan: planEnum('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const membership = pgTable('membership', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userTenantUnique: uniqueIndex('membership_user_tenant_uidx').on(t.userId, t.tenantId),
}))

// Invitations (Slice 3) : un membre habilité (`members:manage`) invite par e-mail avec un rôle.
// Le `token` opaque EST la capacité d'acceptation (bearer). Usage unique (status → accepted).
// Sous RLS (clefée sur tenant_id) comme membership : les endpoints de gestion tournent sur appDb
// dans withTenantTx ; l'acceptation par token tourne sur systemDb (pré-contexte).
export const invitation = pgTable('invitation', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  // Rôle attribué à l'acceptation. Contrainte applicative : jamais 'owner' à l'invitation
  // (l'ownership se transfère séparément) — l'enum réutilise `role` par simplicité.
  role: roleEnum('role').notNull().default('member'),
  token: text('token').notNull().unique(),
  invitedBy: text('invited_by').notNull().references(() => user.id),
  status: invitationStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('invitation_tenant_idx').on(t.tenantId),
  emailIdx: index('invitation_email_idx').on(t.email),
}))

export const quiz = pgTable('quiz', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  description: text('description'),
  cover: text('cover'),
  // Attribution du contenu importé de la bibliothèque (null pour un quiz créé à la main).
  source: jsonb('source').$type<ContentSource>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('quiz_tenant_idx').on(t.tenantId),
  // Cible référençable par la FK composite des tables enfants (question.tenant_id doit coller au quiz).
  idTenantUq: uniqueIndex('quiz_id_tenant_uidx').on(t.id, t.tenantId),
}))

export const question = pgTable('question', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  media: text('media'),
  timeLimit: integer('time_limit').notNull().default(20),
  readingTime: integer('reading_time').notNull().default(6),
  orderIndex: integer('order_index').notNull(),
  payload: jsonb('payload').notNull(),
  source: jsonb('source').$type<ContentSource>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quizOrderIdx: index('question_quiz_order_idx').on(t.quizId, t.orderIndex),
  tenantIdx: index('question_tenant_idx').on(t.tenantId),
  // Garantie base : tenant_id enfant DOIT coller au tenant du quiz parent.
  quizTenantFk: foreignKey({
    columns: [t.quizId, t.tenantId],
    foreignColumns: [quiz.id, quiz.tenantId],
    name: 'question_quiz_tenant_fk',
  }),
}))

export const gameSession = pgTable('game_session', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id),
  hostId: text('host_id').notNull().references(() => user.id),
  pin: text('pin').notNull(),
  status: sessionStatusEnum('status').notNull().default('lobby'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  // État moteur sérialisé (résumé après crash serveur) : nul tant que la session
  // n'a pas été checkpointée par le moteur (@splootlabs/game, Task 2/3).
  engineState: jsonb('engine_state'),
}, (t) => ({
  // PIN unique PARMI les sessions actives (index partiel Postgres)
  activePinUnique: uniqueIndex('game_session_active_pin_uidx').on(t.pin).where(sql`${t.status} in ('lobby', 'active')`),
  tenantIdx: index('game_session_tenant_idx').on(t.tenantId),
  // Cible référençable par la FK composite de session_player et answer_record.
  idTenantUq: uniqueIndex('game_session_id_tenant_uidx').on(t.id, t.tenantId),
}))

export const sessionPlayer = pgTable('session_player', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  nickname: text('nickname').notNull(),
  joinToken: text('join_token').notNull(),
  totalScore: integer('total_score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('session_player_session_idx').on(t.sessionId),
  tenantIdx: index('session_player_tenant_idx').on(t.tenantId),
  // Garantie base : tenant_id enfant DOIT coller au tenant de la session parente.
  sessionTenantFk: foreignKey({
    columns: [t.sessionId, t.tenantId],
    foreignColumns: [gameSession.id, gameSession.tenantId],
    name: 'session_player_session_tenant_fk',
  }),
}))

export const answerRecord = pgTable('answer_record', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  questionId: uuid('question_id').notNull().references(() => question.id),
  playerId: uuid('player_id').notNull().references(() => sessionPlayer.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').notNull(),
  timeMs: integer('time_ms').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  points: integer('points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionQuestionIdx: index('answer_session_question_idx').on(t.sessionId, t.questionId),
  // Unicité (session, question, joueur) : un joueur ne répond qu'une fois par question. Permet un
  // `recordAnswer` IDEMPOTENT (ON CONFLICT DO NOTHING) → la persistance d'une manche est rejouable
  // sans double-insert. Base de la cicatrisation de la fenêtre de crash reveal()/persistRound
  // (P1-8) : au redémarrage, on ré-écrit les answer_record des manches créditées sans risque.
  sessionQuestionPlayerUnique: uniqueIndex('answer_session_question_player_uidx').on(
    t.sessionId,
    t.questionId,
    t.playerId,
  ),
  tenantIdx: index('answer_record_tenant_idx').on(t.tenantId),
  // Garantie base : tenant_id enfant DOIT coller au tenant de la session parente.
  sessionTenantFk: foreignKey({
    columns: [t.sessionId, t.tenantId],
    foreignColumns: [gameSession.id, gameSession.tenantId],
    name: 'answer_record_session_tenant_fk',
  }),
}))

// Tables Better Auth (user/session/account/verification) — générées, source de vérité des colonnes.
export * from './auth-schema.js'

// Catalogue de la bibliothèque : global (ni tenant_id ni RLS), lecture seule pour app_role,
// écrit uniquement par la synchronisation sur la connexion privilégiée.
export const libraryTheme = pgTable('library_theme', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  hidden: boolean('hidden').notNull().default(false),
  origin: libraryOriginEnum('origin').notNull(),
})

export const libraryQuestion = pgTable('library_question', {
  id: text('id').primaryKey(),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  // Prompt en minuscules sans diacritiques, calculé à la synchronisation (recherche).
  promptSearch: text('prompt_search').notNull(),
  payload: jsonb('payload').notNull(),
  themeId: text('theme_id').notNull().references(() => libraryTheme.id),
  difficulty: libraryDifficultyEnum('difficulty').notNull(),
  language: text('language').notNull(),
  audience: libraryAudienceEnum('audience').notNull(),
  timeLimit: integer('time_limit').notNull(),
  readingTime: integer('reading_time').notNull(),
  source: jsonb('source').$type<ContentSource>().notNull(),
  origin: libraryOriginEnum('origin').notNull(),
  originFile: text('origin_file').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  criteriaIdx: index('library_question_criteria_idx').on(t.themeId, t.difficulty, t.language, t.audience),
}))

export const libraryQuiz = pgTable('library_quiz', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  themeId: text('theme_id').notNull().references(() => libraryTheme.id),
  difficulty: libraryDifficultyEnum('difficulty').notNull(),
  language: text('language').notNull(),
  audience: libraryAudienceEnum('audience').notNull(),
  source: jsonb('source').$type<ContentSource>().notNull(),
  origin: libraryOriginEnum('origin').notNull(),
  originFile: text('origin_file').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const libraryQuizQuestion = pgTable('library_quiz_question', {
  quizId: text('quiz_id').notNull().references(() => libraryQuiz.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull().references(() => libraryQuestion.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.quizId, t.position] }),
}))
