import type { QuestionType } from '@splootlabs/quiz'

export type Phase = 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'

export type Player = {
  id: string
  nickname: string
  joinToken: string
  score: number
  connected: boolean
}

/** Question telle que vue par le moteur (payload complet, incluant la bonne réponse). */
export type EngineQuestion = {
  id: string
  type: QuestionType
  prompt: string
  timeLimit: number // secondes
  basePoints: number
  payload: unknown
}

export type SubmittedAnswer = {
  answer: unknown
  timeMs: number
  correct: boolean
  points: number
}

export type GameSession = {
  id: string
  pin: string
  quizId: string
  tenantId: string
  hostId: string
  phase: Phase
  questions: EngineQuestion[]
  currentIndex: number // -1 en lobby
  questionStartedAt: number | null
  players: Record<string, Player>
  // par index de question, puis par id de joueur
  answers: Record<number, Record<string, SubmittedAnswer>>
}
