import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'
import { speedBonus } from './scoring.js'

const tfSchema = z.object({ correct: z.boolean() })
export type TrueFalsePayload = z.infer<typeof tfSchema>

const answerSchema = z.object({ value: z.boolean() })
export type TrueFalseAnswer = z.infer<typeof answerSchema>

export const truefalse: QuestionTypeDef<TrueFalsePayload, TrueFalseAnswer> = {
  key: 'truefalse',
  validatePayload: (raw) => tfSchema.parse(raw),
  validateAnswer: (raw) => answerSchema.parse(raw),
  playerView: () => ({}), // pas de `correct`
  isCorrect: (p, a) => a.value === p.correct,
  score: (p, a, o) => (truefalse.isCorrect(p, a) ? speedBonus(o.basePoints, o.timeMs, o.maxMs) : 0),
}
