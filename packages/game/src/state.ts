import type { QuestionType } from '@splootlabs/quiz'

export type Phase = 'lobby' | 'reading' | 'question' | 'reveal' | 'scoreboard' | 'podium'

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
  readingTime: number // secondes, 0 = pas de phase de lecture (rétro-compatible)
  basePoints: number
  payload: unknown
  // Image facultative. Optionnels car l'état moteur est persisté en JSON : un état écrit avant
  // cette version n'a pas ces clés (les projections renvoient alors null).
  media?: string | null
  mediaAlt?: string | null
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
  readingStartedAt: number | null
  players: Record<string, Player>
  // par index de question, puis par id de joueur
  answers: Record<number, Record<string, SubmittedAnswer>>
  // par index de question : true une fois que ses points ont été crédités aux joueurs (reveal()
  // idempotent, découplé de `phase` — voir engine.ts:reveal).
  credited: Record<number, boolean>
}
