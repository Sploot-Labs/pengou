import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'
import { speedBonus } from './scoring.js'

const mcqSchema = z.object({
  options: z.array(z.object({ label: z.string().min(1), correct: z.boolean() })).min(2).max(6),
}).refine((p) => p.options.some((o) => o.correct), { message: 'au moins une option correcte requise' })

export type McqPayload = z.infer<typeof mcqSchema>

const answerSchema = z.object({ optionIndex: z.number().int().nonnegative() })
export type McqAnswer = z.infer<typeof answerSchema>

export const mcq: QuestionTypeDef<McqPayload, McqAnswer> = {
  key: 'mcq',
  validatePayload: (raw) => mcqSchema.parse(raw),
  validateAnswer: (raw) => answerSchema.parse(raw),
  playerView: (p) => ({ options: p.options.map((o) => ({ label: o.label })) }), // pas de `correct`
  isCorrect: (p, a) => p.options[a.optionIndex]?.correct === true,
  score: (p, a, o) => (mcq.isCorrect(p, a) ? speedBonus(o.basePoints, o.timeMs, o.maxMs) : 0),
}
