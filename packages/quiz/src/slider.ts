import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'

const sliderSchema = z.object({
  min: z.number(),
  max: z.number(),
  correct: z.number(),
  step: z.number().positive().optional(),
}).refine((p) => p.min < p.max, { message: 'min doit être < max' })
  .refine((p) => p.correct >= p.min && p.correct <= p.max, { message: 'correct doit être dans [min, max]' })

export type SliderPayload = z.infer<typeof sliderSchema>

export const slider: QuestionTypeDef<SliderPayload> = {
  key: 'slider',
  validatePayload: (raw) => sliderSchema.parse(raw),
}
