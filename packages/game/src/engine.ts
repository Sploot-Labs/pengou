import { questionTypes } from '@splootlabs/quiz'
import type { GameSession, Player, EngineQuestion, SubmittedAnswer } from './state.js'
import type { SessionStore } from './store.js'

export type CreateSessionInput = {
  quizId: string
  tenantId: string
  hostId: string
  questions: EngineQuestion[]
}

export type SubmitAnswerResult = { accepted: boolean; reason?: string }

export type RankingEntry = { playerId: string; nickname: string; score: number }

/** Projection question envoyée aux joueurs — ne DOIT jamais contenir la bonne réponse. */
export type PlayerQuestionView = {
  id: string
  type: EngineQuestion['type']
  prompt: string
  timeLimit: number
  payload: unknown
} | null

export type QuestionResult = {
  correct: unknown
  distribution: Record<string, number>
}

export type EngineDeps = {
  store: SessionStore
  /** Horloge injectée (jamais Date.now dans le moteur) — pour un timing déterministe/testable. */
  now: () => number
  /** Générateur de PIN injecté (jamais Math.random dans le moteur). */
  genPin: () => string
  /** Générateur d'identifiants injecté (jamais Math.random/uuid direct dans le moteur). */
  genId: () => string
}

export interface Engine {
  createSession(input: CreateSessionInput): Promise<GameSession>
  addPlayer(sessionId: string, nickname: string): Promise<{ session: GameSession; player: Player }>
  startQuestion(sessionId: string): Promise<GameSession>
  submitAnswer(sessionId: string, playerId: string, rawAnswer: unknown): Promise<SubmitAnswerResult>
  reveal(sessionId: string): Promise<GameSession>
  scoreboard(sessionId: string): Promise<GameSession>
  nextQuestion(sessionId: string): Promise<GameSession>
  podium(sessionId: string): Promise<GameSession>
  ranking(session: GameSession): RankingEntry[]
  playerQuestionView(session: GameSession): PlayerQuestionView
  questionResult(session: GameSession): QuestionResult
}

export function createEngine(deps: EngineDeps): Engine {
  const { store, now, genPin, genId } = deps

  async function requireSession(sessionId: string): Promise<GameSession> {
    const session = await store.get(sessionId)
    if (!session) throw new Error(`session introuvable : ${sessionId}`)
    return session
  }

  /** PIN unique parmi les sessions actives : retente tant que genPin() collide. */
  async function uniquePin(): Promise<string> {
    for (;;) {
      const pin = genPin()
      const collision = await store.getByPin(pin)
      if (!collision) return pin
    }
  }

  function currentQuestion(session: GameSession): EngineQuestion | undefined {
    return session.questions[session.currentIndex]
  }

  const engine: Engine = {
    async createSession({ quizId, tenantId, hostId, questions }) {
      const pin = await uniquePin()
      const session: GameSession = {
        id: genId(),
        pin,
        quizId,
        tenantId,
        hostId,
        phase: 'lobby',
        questions,
        currentIndex: -1,
        questionStartedAt: null,
        players: {},
        answers: {},
      }
      await store.save(session)
      return session
    },

    async addPlayer(sessionId, nickname) {
      const session = await requireSession(sessionId)
      const player: Player = {
        id: genId(),
        nickname,
        joinToken: genId(),
        score: 0,
        connected: true,
      }
      session.players[player.id] = player
      await store.save(session)
      return { session, player }
    },

    async startQuestion(sessionId) {
      const session = await requireSession(sessionId)
      const nextIndex = session.currentIndex + 1
      if (nextIndex >= session.questions.length) {
        throw new Error('startQuestion : plus de questions disponibles')
      }
      session.currentIndex = nextIndex
      session.phase = 'question'
      session.questionStartedAt = now()
      await store.save(session)
      return session
    },

    async submitAnswer(sessionId, playerId, rawAnswer) {
      const session = await requireSession(sessionId)

      if (session.phase !== 'question') {
        return { accepted: false, reason: 'hors phase question' }
      }
      if (!session.players[playerId]) {
        return { accepted: false, reason: 'joueur inconnu' }
      }
      const question = currentQuestion(session)
      if (!question) {
        return { accepted: false, reason: 'aucune question active' }
      }
      const alreadyAnswered = session.answers[session.currentIndex]?.[playerId]
      if (alreadyAnswered) {
        return { accepted: false, reason: 'réponse déjà soumise pour cette question' }
      }

      const def = questionTypes[question.type]
      let answer: unknown
      try {
        answer = def.validateAnswer(rawAnswer)
      } catch {
        return { accepted: false, reason: 'réponse invalide pour ce type de question' }
      }

      // Horodatage 100% serveur : jamais de confiance dans un timing fourni par le client.
      const maxMs = question.timeLimit * 1000
      const startedAt = session.questionStartedAt ?? now()
      const rawTimeMs = now() - startedAt
      const timeMs = Math.max(0, Math.min(rawTimeMs, maxMs))

      const correct = def.isCorrect(question.payload, answer)
      const points = def.score(question.payload, answer, { timeMs, maxMs, basePoints: question.basePoints })

      const submitted: SubmittedAnswer = { answer, timeMs, correct, points }
      if (!session.answers[session.currentIndex]) session.answers[session.currentIndex] = {}
      session.answers[session.currentIndex]![playerId] = submitted

      await store.save(session)
      return { accepted: true }
    },

    async reveal(sessionId) {
      const session = await requireSession(sessionId)
      // Idempotent : on ne crédite les points qu'une seule fois, à la transition question→reveal.
      // Un appel répété à reveal() (déjà en phase reveal ou plus loin) ne recrédite pas les scores.
      if (session.phase === 'question') {
        const roundAnswers = session.answers[session.currentIndex] ?? {}
        for (const [playerId, submitted] of Object.entries(roundAnswers)) {
          const player = session.players[playerId]
          if (player) player.score += submitted.points
        }
      }
      session.phase = 'reveal'
      await store.save(session)
      return session
    },

    async scoreboard(sessionId) {
      const session = await requireSession(sessionId)
      session.phase = 'scoreboard'
      await store.save(session)
      return session
    },

    async nextQuestion(sessionId) {
      const session = await requireSession(sessionId)
      if (session.currentIndex + 1 < session.questions.length) {
        return engine.startQuestion(sessionId)
      }
      return engine.podium(sessionId)
    },

    async podium(sessionId) {
      const session = await requireSession(sessionId)
      session.phase = 'podium'
      await store.save(session)
      return session
    },

    ranking(session) {
      return Object.values(session.players)
        .map((p) => ({ playerId: p.id, nickname: p.nickname, score: p.score }))
        .sort((a, b) => b.score - a.score)
    },

    playerQuestionView(session) {
      const question = currentQuestion(session)
      if (!question) return null
      const def = questionTypes[question.type]
      return {
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        timeLimit: question.timeLimit,
        payload: def.playerView(question.payload),
      }
    },

    questionResult(session) {
      const question = currentQuestion(session)
      const roundAnswers = session.answers[session.currentIndex] ?? {}
      const distribution: Record<string, number> = {}
      for (const submitted of Object.values(roundAnswers)) {
        const key = JSON.stringify(submitted.answer)
        distribution[key] = (distribution[key] ?? 0) + 1
      }
      return { correct: question?.payload, distribution }
    },
  }

  return engine
}
