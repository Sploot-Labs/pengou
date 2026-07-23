export type QuestionType = 'mcq' | 'truefalse' | 'text' | 'slider'

export interface ScoreOpts {
  timeMs: number
  maxMs: number
  basePoints: number
}

export interface QuestionTypeDef<P = unknown, A = unknown> {
  key: QuestionType
  validatePayload(raw: unknown): P
  validateAnswer(raw: unknown): A
  /** Projection sans la bonne réponse, envoyable aux joueurs. */
  playerView(payload: P): unknown
  isCorrect(payload: P, answer: A): boolean
  score(payload: P, answer: A, opts: ScoreOpts): number
}
