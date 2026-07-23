import { desc, eq } from 'drizzle-orm'
import { schema } from '../index.js'
import type { Db } from '../client.js'
import type { TenantScope } from '../tenant.js'
import { getQuiz } from './quiz.js'

export type GameSession = typeof schema.gameSession.$inferSelect
export type SessionPlayer = typeof schema.sessionPlayer.$inferSelect
export type AnswerRecord = typeof schema.answerRecord.$inferSelect
export type SessionStatus = GameSession['status']

// Une session appartient au tenant du quiz : on vérifie via getQuiz (même garde
// que question.ts) avant d'écrire — pas de tenantId pris depuis l'input.
export async function createGameSession(
  scope: TenantScope,
  input: { quizId: string; hostId: string; pin: string },
): Promise<GameSession | null> {
  const quiz = await getQuiz(scope, input.quizId)
  if (!quiz) return null
  // NB : un PIN dupliqué parmi les sessions actives (status <> 'ended') viole
  // l'index partiel unique `game_session_active_pin_uidx`. On NE catch PAS ici :
  // le moteur (@splootlabs/game, Task 2) garantit déjà l'unicité en mémoire avant
  // d'appeler ce repo, donc une violation ici ne peut venir que d'une course ou
  // d'un bug appelant — elle doit remonter comme une erreur franche plutôt que
  // d'être avalée silencieusement (le repo ne sait pas régénérer un PIN).
  const [row] = await scope.db.insert(schema.gameSession).values({
    tenantId: scope.tenantId,
    quizId: input.quizId,
    hostId: input.hostId,
    pin: input.pin,
  }).returning()
  return row
}

export async function addSessionPlayer(
  db: Db,
  sessionId: string,
  input: { nickname: string; joinToken: string },
): Promise<SessionPlayer> {
  const [row] = await db.insert(schema.sessionPlayer).values({
    sessionId,
    nickname: input.nickname,
    joinToken: input.joinToken,
  }).returning()
  return row
}

export async function recordAnswer(
  db: Db,
  input: {
    sessionId: string
    questionId: string
    playerId: string
    answer: unknown
    timeMs: number
    isCorrect: boolean
    points: number
  },
): Promise<void> {
  await db.insert(schema.answerRecord).values({
    sessionId: input.sessionId,
    questionId: input.questionId,
    playerId: input.playerId,
    answer: input.answer as never,
    timeMs: input.timeMs,
    isCorrect: input.isCorrect,
    points: input.points,
  })
}

// `at` renseigne l'horodatage correspondant à la transition :
// - status 'active' → startedAt (défaut : maintenant)
// - status 'ended'  → endedAt   (défaut : maintenant)
export async function setSessionStatus(
  db: Db,
  sessionId: string,
  status: SessionStatus,
  at?: Date,
): Promise<void> {
  const patch: Partial<typeof schema.gameSession.$inferInsert> = { status }
  if (status === 'active') patch.startedAt = at ?? new Date()
  if (status === 'ended') patch.endedAt = at ?? new Date()
  await db.update(schema.gameSession).set(patch).where(eq(schema.gameSession.id, sessionId))
}

export async function setPlayerScore(db: Db, playerId: string, totalScore: number): Promise<void> {
  await db.update(schema.sessionPlayer).set({ totalScore }).where(eq(schema.sessionPlayer.id, playerId))
}

// Classement d'une session : joueurs triés par total_score desc (podium/scoreboard).
export async function listSessionPlayersByScore(db: Db, sessionId: string): Promise<SessionPlayer[]> {
  return db.select().from(schema.sessionPlayer)
    .where(eq(schema.sessionPlayer.sessionId, sessionId))
    .orderBy(desc(schema.sessionPlayer.totalScore))
}
