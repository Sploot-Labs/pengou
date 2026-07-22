import { sql } from 'drizzle-orm'
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core'

export const planEnum = pgEnum('plan', ['free', 'pro'])
export const roleEnum = pgEnum('role', ['owner', 'admin', 'member'])
export const questionTypeEnum = pgEnum('question_type', ['mcq', 'truefalse', 'text', 'slider'])
export const sessionStatusEnum = pgEnum('session_status', ['lobby', 'active', 'ended'])

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  plan: planEnum('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const user = pgTable('user', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'), // null pour un compte OAuth-only
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const oauthAccount = pgTable('oauth_account', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerUnique: uniqueIndex('oauth_provider_account_uidx').on(t.provider, t.providerAccountId),
}))

export const membership = pgTable('membership', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userTenantUnique: uniqueIndex('membership_user_tenant_uidx').on(t.userId, t.tenantId),
}))

export const quiz = pgTable('quiz', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  description: text('description'),
  cover: text('cover'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('quiz_tenant_idx').on(t.tenantId),
}))

export const question = pgTable('question', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  media: text('media'),
  timeLimit: integer('time_limit').notNull().default(20),
  orderIndex: integer('order_index').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quizOrderIdx: index('question_quiz_order_idx').on(t.quizId, t.orderIndex),
}))

export const gameSession = pgTable('game_session', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id),
  hostId: uuid('host_id').notNull().references(() => user.id),
  pin: text('pin').notNull(),
  status: sessionStatusEnum('status').notNull().default('lobby'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // PIN unique PARMI les sessions actives (index partiel Postgres)
  activePinUnique: uniqueIndex('game_session_active_pin_uidx').on(t.pin).where(sql`${t.status} <> 'ended'`),
  tenantIdx: index('game_session_tenant_idx').on(t.tenantId),
}))

export const sessionPlayer = pgTable('session_player', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  nickname: text('nickname').notNull(),
  joinToken: text('join_token').notNull(),
  totalScore: integer('total_score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('session_player_session_idx').on(t.sessionId),
}))

export const answerRecord = pgTable('answer_record', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => question.id),
  playerId: uuid('player_id').notNull().references(() => sessionPlayer.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').notNull(),
  timeMs: integer('time_ms').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  points: integer('points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionQuestionIdx: index('answer_session_question_idx').on(t.sessionId, t.questionId),
}))
