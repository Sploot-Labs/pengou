import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { aggregateWords, tallyPoll, type PollAnswer, type PollPayload } from '@splootlabs/quiz'
import { schema } from '../index.js'
import { loadWordcloudRemoved } from './session.js'
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
    /** null pour un nuage de mots et un sondage (pas de bonne réponse). */
    correctCount: number | null
    /** null pour un nuage de mots et un sondage, ou sans réponse. */
    avgTimeMs: number | null
    /** Agrégat des mots pour un nuage, null pour les autres types. */
    wordcloud: { participants: number; totalWords: number; words: { text: string; count: number }[] } | null
    /** Répartition des votes pour un sondage, null pour les autres types. */
    poll: { voters: number; multiple: boolean; options: { label: string; votes: number }[] } | null
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

/**
 * Prédicat d'appartenance : en scope utilisateur (`ownerId` présent), on ne voit que les
 * parties dont on est l'hôte (`game_session.host_id`). En scope système, `undefined` →
 * accès tenant-large (inchangé). Ferme la faille P0 : sans ce filtre, tout membre du tenant
 * pouvait lire les rapports (scores, pseudos, réponses) des parties d'autrui.
 */
function hostPredicate(scope: TenantScope) {
  return scope.ownerId ? eq(schema.gameSession.hostId, scope.ownerId) : undefined
}

// Liste des parties du tenant, plus récentes d'abord. `playerCount` vient d'un
// left join agrégé (count distinct) pour couvrir les sessions sans joueur
// (lobby jamais rejoint) sans les exclure de la liste.
export async function listSessions(
  scope: TenantScope,
  opts?: { limit?: number; status?: SessionSummary['status'][] },
): Promise<SessionSummary[]> {
  const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
  // Combine : tenant + appartenance au propriétaire (hostPredicate, faille P0) + filtre de statut
  // optionnel (feature « abandon des parties inactives »). `and(...)` ignore les prédicats undefined.
  const conditions = [eq(schema.gameSession.tenantId, scope.tenantId), hostPredicate(scope)]
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
    .leftJoin(
      schema.sessionPlayer,
      and(eq(schema.sessionPlayer.sessionId, schema.gameSession.id), eq(schema.sessionPlayer.tenantId, scope.tenantId)),
    )
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
    .where(
      and(eq(schema.gameSession.id, sessionId), eq(schema.gameSession.tenantId, scope.tenantId), hostPredicate(scope)),
    )
    .limit(1)
  if (!session) return null

  // Toutes les questions du quiz (même celles sans réponse) : left join sur
  // answer_record filtré par CETTE session -- une question sans réponse
  // ressort avec answerCount/correctCount à 0 et avgTimeMs à null (pas 0 :
  // une moyenne sur zéro valeur n'existe pas, on ne l'invente pas).
  const questionRows = await scope.db
    .select({
      questionId: schema.question.id,
      prompt: schema.question.prompt,
      type: schema.question.type,
      orderIndex: schema.question.orderIndex,
      payload: schema.question.payload,
      answerCount: sql<number>`count(${schema.answerRecord.id})`.mapWith(Number),
      correctCount:
        sql<number>`count(${schema.answerRecord.id}) filter (where ${schema.answerRecord.isCorrect})`.mapWith(Number),
      avgTimeMs: sql<number | null>`avg(${schema.answerRecord.timeMs})`.mapWith((v) => (v === null ? null : Number(v))),
    })
    .from(schema.question)
    .leftJoin(
      schema.answerRecord,
      and(
        eq(schema.answerRecord.questionId, schema.question.id),
        eq(schema.answerRecord.sessionId, sessionId),
        eq(schema.answerRecord.tenantId, scope.tenantId),
      ),
    )
    .where(and(eq(schema.question.quizId, session.quizId), eq(schema.question.tenantId, scope.tenantId)))
    .groupBy(schema.question.id)
    .orderBy(schema.question.orderIndex)

  // Nuages de mots : réponses de la session lues une fois, retraits depuis la colonne dédiée
  // (engine_state est vidé au podium, ce n'est pas une source pour les rapports).
  const cloudIds = questionRows.filter((q) => q.type === 'wordcloud').map((q) => q.questionId)
  const wordsByQuestion = new Map<string, { words: string[] }[]>()
  let removed: Record<string, string[]> = {}
  if (cloudIds.length > 0) {
    removed = await loadWordcloudRemoved(scope.db, sessionId)
    const rows = await scope.db
      .select({ questionId: schema.answerRecord.questionId, answer: schema.answerRecord.answer })
      .from(schema.answerRecord)
      .where(
        and(
          eq(schema.answerRecord.sessionId, sessionId),
          eq(schema.answerRecord.tenantId, scope.tenantId),
          inArray(schema.answerRecord.questionId, cloudIds),
        ),
      )
    for (const r of rows) {
      const words = (r.answer as { words?: unknown } | null)?.words
      if (!Array.isArray(words)) continue
      const list = wordsByQuestion.get(r.questionId) ?? []
      list.push({ words: words.filter((w): w is string => typeof w === 'string') })
      wordsByQuestion.set(r.questionId, list)
    }
  }

  // Sondages : indices de vote lus une fois pour la session, dépouillés par tallyPoll.
  const pollIds = questionRows.filter((q) => q.type === 'poll').map((q) => q.questionId)
  const pollAnswers = new Map<string, PollAnswer[]>()
  if (pollIds.length > 0) {
    const rows = await scope.db
      .select({ questionId: schema.answerRecord.questionId, answer: schema.answerRecord.answer })
      .from(schema.answerRecord)
      .where(
        and(
          eq(schema.answerRecord.sessionId, sessionId),
          eq(schema.answerRecord.tenantId, scope.tenantId),
          inArray(schema.answerRecord.questionId, pollIds),
        ),
      )
    for (const r of rows) {
      const idx = (r.answer as { optionIndexes?: unknown } | null)?.optionIndexes
      if (!Array.isArray(idx)) continue
      const list = pollAnswers.get(r.questionId) ?? []
      list.push({ optionIndexes: idx.filter((i): i is number => typeof i === 'number') })
      pollAnswers.set(r.questionId, list)
    }
  }
  const questions: SessionReport['questions'] = questionRows.map(({ payload, ...q }) => {
    if (q.type === 'poll') {
      const p = payload as PollPayload
      const tally = tallyPoll(p.options.length, pollAnswers.get(q.questionId) ?? [])
      return {
        ...q,
        answerCount: tally.voters,
        correctCount: null,
        avgTimeMs: null,
        wordcloud: null,
        poll: {
          voters: tally.voters,
          multiple: p.multiple === true,
          options: p.options.map((o, i) => ({ label: o.label, votes: tally.votes[i] ?? 0 })),
        },
      }
    }
    if (q.type !== 'wordcloud') return { ...q, wordcloud: null, poll: null }
    const agg = aggregateWords(wordsByQuestion.get(q.questionId) ?? [], new Set(removed[q.questionId] ?? []))
    return {
      ...q,
      correctCount: null,
      avgTimeMs: null,
      poll: null,
      wordcloud: {
        participants: agg.participants,
        totalWords: agg.totalWords,
        words: agg.words.map((w) => ({ text: w.text, count: w.count })),
      },
    }
  })

  // Tous les joueurs de la session, triés par score desc (podium). `totalScore`
  // vient de session_player (déjà tenu à jour par le moteur), correctCount/
  // answerCount agrègent leurs answer_record.
  const players = await scope.db
    .select({
      playerId: schema.sessionPlayer.id,
      nickname: schema.sessionPlayer.nickname,
      totalScore: schema.sessionPlayer.totalScore,
      correctCount:
        sql<number>`count(${schema.answerRecord.id}) filter (where ${schema.answerRecord.isCorrect})`.mapWith(Number),
      answerCount: sql<number>`count(${schema.answerRecord.id})`.mapWith(Number),
    })
    .from(schema.sessionPlayer)
    .leftJoin(
      schema.answerRecord,
      and(
        eq(schema.answerRecord.playerId, schema.sessionPlayer.id),
        eq(schema.answerRecord.tenantId, scope.tenantId),
        // Les nuages de mots et les sondages ne comptent ni comme réponse donnée ni comme réponse correcte.
        sql`${schema.answerRecord.questionId} in (select id from question where type not in ('wordcloud', 'poll'))`,
      ),
    )
    .where(and(eq(schema.sessionPlayer.sessionId, sessionId), eq(schema.sessionPlayer.tenantId, scope.tenantId)))
    .groupBy(schema.sessionPlayer.id)
    .orderBy(desc(schema.sessionPlayer.totalScore))

  return { session, questions, players }
}
