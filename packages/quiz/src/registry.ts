import type { QuestionType, QuestionTypeDef } from './types.js'
import { mcq } from './mcq.js'
import { truefalse } from './truefalse.js'
import { text } from './text.js'
import { slider } from './slider.js'
import { wordcloud } from './wordcloud.js'
import { poll } from './poll.js'

export const questionTypes: Record<QuestionType, QuestionTypeDef> = { mcq, truefalse, text, slider, wordcloud, poll }

export function isScoredType(type: QuestionType): boolean {
  return questionTypes[type].scored
}

export function validateQuestionPayload(type: QuestionType, raw: unknown): unknown {
  const def = questionTypes[type]
  if (!def) throw new Error(`type de question inconnu : ${type}`)
  return def.validatePayload(raw)
}
