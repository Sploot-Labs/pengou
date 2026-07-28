import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { schema } from '../index.js'
import type { TenantScope } from '../tenant.js'

export type SessionSummary = {
  id: string
  pin: string
  status: (typeof schema.gameSession.$inferSelect)['status']
  startedAt: Date | null
  endedAt: Date | null
  quizId: string
  quizTitle: string
  playerCount: number
}

export type SessionReport = {
  session: {
    id: string
    pin: string
    status: (typeof schema.gameSession.$inferSelect)['status']
    startedAt: Date | null
    endedAt: Date | null
    quizId: string
    quizTitle: string
  }
  questions: {
    questionId: string
    prompt: string
    type: (typeof schema.question.$inferSelect)['type']
    orderIndex: number
    answerCount: number
    correctCount: number
    avgTimeMs: number | null
  }[]
  players: {
    playerId: string
    nickname: string
    totalScore: number
    correctCount: number
    answerCount: number
  }[]
}

const DEFAULT_LIST_LIMIT = 50

// Liste des parties du tenant, plus récentes d'abord. `playerCount` vient d'un
// left join agrégé (count distinct) pour couvrir les sessions sans joueur
// (lobby jamais rejoint) sans les exclure de la liste.
export async function listSessions(
  scope: TenantScope,
  opts?: { limit?: number; status?: SessionSummary['status'][] },
): Promise<SessionSummary[]> {
  const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
  const conditions = [eq(schema.gameSession.tenantId, scope.tenantId)]
  if (opts?.status && opts.status.length > 0) {
    conditions.push(inArray(schema.gameSession.status, opts.status))
  }
  return scope.db
    .select({
      id: schema.gameSession.id,
      pin: schema.gameSession.pin,
      status: schema.gameSession.status,
      startedAt: schema.gameSession.startedAt,
      endedAt: schema.gameSession.endedAt,
      quizId: schema.gameSession.quizId,
      quizTitle: schema.quiz.title,
      playerCount: sql<number>`count(distinct ${schema.sessionPlayer.id})`.mapWith(Number),
    })
    .from(schema.gameSession)
    .innerJoin(schema.quiz, eq(schema.quiz.id, schema.gameSession.quizId))
    .leftJoin(schema.sessionPlayer, and(
      eq(schema.sessionPlayer.sessionId, schema.gameSession.id),
      eq(schema.sessionPlayer.tenantId, scope.tenantId),
    ))
    .where(and(...conditions))
    .groupBy(schema.gameSession.id, schema.quiz.title)
    .orderBy(desc(schema.gameSession.createdAt))
    .limit(limit)
}

// Rapport détaillé d'une partie : null si la session n'existe pas OU
// n'appartient pas au tenant du scope (même garde, aucun oracle d'existence
// distinct pour le client — cf. Global Constraints du plan).
export async function getSessionReport(scope: TenantScope, sessionId: string): Promise<SessionReport | null> {
  const [session] = await scope.db
    .select({
      id: schema.gameSession.id,
      pin: schema.gameSession.pin,
      status: schema.gameSession.status,
      startedAt: schema.gameSession.startedAt,
      endedAt: schema.gameSession.endedAt,
      quizId: schema.gameSession.quizId,
      quizTitle: schema.quiz.title,
    })
    .from(schema.gameSession)
    .innerJoin(schema.quiz, eq(schema.quiz.id, schema.gameSession.quizId))
    .where(and(eq(schema.gameSession.id, sessionId), eq(schema.gameSession.tenantId, scope.tenantId)))
    .limit(1)
  if (!session) return null

  // Toutes les questions du quiz (même celles sans réponse) : left join sur
  // answer_record filtré par CETTE session -- une question sans réponse
  // ressort avec answerCount/correctCount à 0 et avgTimeMs à null (pas 0 :
  // une moyenne sur zéro valeur n'existe pas, on ne l'invente pas).
  const questions = await scope.db
    .select({
      questionId: schema.question.id,
      prompt: schema.question.prompt,
      type: schema.question.type,
      orderIndex: schema.question.orderIndex,
      answerCount: sql<number>`count(${schema.answerRecord.id})`.mapWith(Number),
      correctCount: sql<number>`count(${schema.answerRecord.id}) filter (where ${schema.answerRecord.isCorrect})`.mapWith(Number),
      avgTimeMs: sql<number | null>`avg(${schema.answerRecord.timeMs})`.mapWith((v) => (v === null ? null : Number(v))),
    })
    .from(schema.question)
    .leftJoin(
      schema.answerRecord,
      and(eq(schema.answerRecord.questionId, schema.question.id), eq(schema.answerRecord.sessionId, sessionId)),
    )
    .where(and(eq(schema.question.quizId, session.quizId), eq(schema.question.tenantId, scope.tenantId)))
    .groupBy(schema.question.id)
    .orderBy(schema.question.orderIndex)

  // Tous les joueurs de la session, triés par score desc (podium). `totalScore`
  // vient de session_player (déjà tenu à jour par le moteur), correctCount/
  // answerCount agrègent leurs answer_record.
  const players = await scope.db
    .select({
      playerId: schema.sessionPlayer.id,
      nickname: schema.sessionPlayer.nickname,
      totalScore: schema.sessionPlayer.totalScore,
      correctCount: sql<number>`count(${schema.answerRecord.id}) filter (where ${schema.answerRecord.isCorrect})`.mapWith(Number),
      answerCount: sql<number>`count(${schema.answerRecord.id})`.mapWith(Number),
    })
    .from(schema.sessionPlayer)
    .leftJoin(schema.answerRecord, eq(schema.answerRecord.playerId, schema.sessionPlayer.id))
    .where(and(eq(schema.sessionPlayer.sessionId, sessionId), eq(schema.sessionPlayer.tenantId, scope.tenantId)))
    .groupBy(schema.sessionPlayer.id)
    .orderBy(desc(schema.sessionPlayer.totalScore))

  return { session, questions, players }
}
