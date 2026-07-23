import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'

const tfSchema = z.object({ correct: z.boolean() })
export type TrueFalsePayload = z.infer<typeof tfSchema>

export const truefalse: QuestionTypeDef<TrueFalsePayload> = {
  key: 'truefalse',
  validatePayload: (raw) => tfSchema.parse(raw),
}
