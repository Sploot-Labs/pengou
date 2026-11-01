export type QuestionType = 'mcq' | 'truefalse' | 'text' | 'slider' | 'wordcloud' | 'poll'

export interface ScoreOpts {
  timeMs: number
  maxMs: number
  basePoints: number
}

// NOTE: les méthodes ci-dessous sont déclarées en syntaxe "method-shorthand" (et non en
// propriétés fléchées `validatePayload: (raw: unknown) => P`), donc TS les vérifie de façon
// bivariante sur leurs paramètres. C'est ce qui permet à `Record<QuestionType, QuestionTypeDef>`
// (registry.ts) d'accepter des stratégies concrètes (`QuestionTypeDef<McqPayload, McqAnswer>`, etc.)
// sans erreur sous `strictFunctionTypes`. Ne PAS convertir ces méthodes en propriétés fléchées
// (Task 2+) sans revoir cette assignabilité.
export interface QuestionTypeDef<P = unknown, A = unknown> {
  key: QuestionType
  /** Faux pour les types sans bonne réponse ni points (sondage, nuage de mots). */
  readonly scored: boolean
  validatePayload(raw: unknown): P
  validateAnswer(raw: unknown): A
  /** Projection sans la bonne réponse, envoyable aux joueurs. */
  playerView(payload: P): unknown
  isCorrect(payload: P, answer: A): boolean
  score(payload: P, answer: A, opts: ScoreOpts): number
}
