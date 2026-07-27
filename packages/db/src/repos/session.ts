import {
  and, desc, eq, gte, inArray, isNotNull, lt, ne,
} from 'drizzle-orm'
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

// Lecture directe par id (pas de scope tenant requis : l'appelant — la passerelle Socket.IO,
// `host:reconnect` — connaît déjà l'id de session moteur/DB associé et veut seulement vérifier
// `host_id`, en défense en profondeur de la vérification faite sur l'état mémoire du moteur).
export async function getGameSessionById(db: Db, sessionId: string): Promise<GameSession | null> {
  const [row] = await db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
  return row ?? null
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

// --- Persistance / résumé de session (checkpoint de l'état moteur) ---
//
// Le moteur (@splootlabs/game) sérialise périodiquement son état en mémoire
// dans `engine_state` (jsonb) pour permettre une reprise après crash serveur.
// Ces helpers ne connaissent rien de la forme de l'état : `unknown` de bout en bout.

export async function saveEngineState(db: Db, sessionId: string, state: unknown): Promise<void> {
  await db.update(schema.gameSession)
    .set({ engineState: state as never })
    .where(eq(schema.gameSession.id, sessionId))
}

export async function clearEngineState(db: Db, sessionId: string): Promise<void> {
  await db.update(schema.gameSession)
    .set({ engineState: null })
    .where(eq(schema.gameSession.id, sessionId))
}

export async function loadEngineState(db: Db, sessionId: string): Promise<unknown | null> {
  const [row] = await db.select({ engineState: schema.gameSession.engineState })
    .from(schema.gameSession)
    .where(eq(schema.gameSession.id, sessionId))
  return row?.engineState ?? null
}

// État de la session courante (non close) associée à ce PIN — un PIN ne peut
// correspondre qu'à au plus une session non-`ended` (index partiel unique).
export async function loadEngineStateByPin(db: Db, pin: string): Promise<unknown | null> {
  const [row] = await db.select({ engineState: schema.gameSession.engineState })
    .from(schema.gameSession)
    .where(and(eq(schema.gameSession.pin, pin), ne(schema.gameSession.status, 'ended')))
  return row?.engineState ?? null
}

// Sessions candidates à la reprise au (re)démarrage du serveur : encore en cours
// (lobby/active), avec un checkpoint mémorisé, et pas trop anciennes.
export async function listResumableSessions(
  db: Db,
  maxAgeMs: number,
): Promise<Array<{ id: string; engineState: unknown }>> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  return db.select({ id: schema.gameSession.id, engineState: schema.gameSession.engineState })
    .from(schema.gameSession)
    .where(and(
      inArray(schema.gameSession.status, ['active', 'lobby']),
      isNotNull(schema.gameSession.engineState),
      gte(schema.gameSession.createdAt, cutoff),
    ))
}

// Ménage : les sessions lobby/active trop anciennes pour être reprises sont closes
// et leur checkpoint effacé (pas de resurrection tardive après un long redémarrage).
export async function endStaleSessions(db: Db, maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const rows = await db.update(schema.gameSession)
    .set({ status: 'ended', endedAt: new Date(), engineState: null })
    .where(and(
      inArray(schema.gameSession.status, ['active', 'lobby']),
      lt(schema.gameSession.createdAt, cutoff),
    ))
    .returning({ id: schema.gameSession.id })
  return rows.length
}
