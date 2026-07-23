import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'

const mcqSchema = z.object({
  options: z.array(z.object({ label: z.string().min(1), correct: z.boolean() })).min(2).max(6),
}).refine((p) => p.options.some((o) => o.correct), { message: 'au moins une option correcte requise' })

export type McqPayload = z.infer<typeof mcqSchema>

export const mcq: QuestionTypeDef<McqPayload> = {
  key: 'mcq',
  validatePayload: (raw) => mcqSchema.parse(raw),
}
