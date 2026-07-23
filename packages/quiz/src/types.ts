export type QuestionType = 'mcq' | 'truefalse' | 'text' | 'slider'

export interface QuestionTypeDef<P = unknown> {
  key: QuestionType
  validatePayload(raw: unknown): P
}
