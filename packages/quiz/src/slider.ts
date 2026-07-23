import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'
import { speedBonus } from './scoring.js'

const sliderSchema = z.object({
  min: z.number(),
  max: z.number(),
  correct: z.number(),
  step: z.number().positive().optional(),
}).refine((p) => p.min < p.max, { message: 'min doit être < max' })
  .refine((p) => p.correct >= p.min && p.correct <= p.max, { message: 'correct doit être dans [min, max]' })

export type SliderPayload = z.infer<typeof sliderSchema>

const answerSchema = z.object({ value: z.number() })
export type SliderAnswer = z.infer<typeof answerSchema>

function tolerance(p: SliderPayload): number {
  return Math.max(1, Math.round(0.05 * (p.max - p.min)))
}

export const slider: QuestionTypeDef<SliderPayload, SliderAnswer> = {
  key: 'slider',
  validatePayload: (raw) => sliderSchema.parse(raw),
  validateAnswer: (raw) => answerSchema.parse(raw),
  playerView: (p) => ({ min: p.min, max: p.max }), // pas de `correct`
  isCorrect: (p, a) => Math.abs(a.value - p.correct) <= tolerance(p),
  score: (p, a, o) => {
    if (!slider.isCorrect(p, a)) return 0
    const tol = tolerance(p)
    const distance = Math.abs(a.value - p.correct)
    const proximity = Math.max(0, 1 - distance / tol) // plein si exact, dégressif jusqu'à 0 à la limite de tolérance
    return Math.round(speedBonus(o.basePoints, o.timeMs, o.maxMs) * proximity)
  },
}
