import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'

const textSchema = z.object({
  answers: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().optional().default(false),
})
export type TextPayload = z.infer<typeof textSchema>

export const text: QuestionTypeDef<TextPayload> = {
  key: 'text',
  validatePayload: (raw) => textSchema.parse(raw),
}
