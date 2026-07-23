import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'
import { speedBonus } from './scoring.js'

const textSchema = z.object({
  answers: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().optional().default(false),
})
export type TextPayload = z.infer<typeof textSchema>

const answerSchema = z.object({ text: z.string() })
export type TextAnswer = z.infer<typeof answerSchema>

// Plage Unicode des marques diacritiques combinantes (U+0300–U+036F) laissées par normalize('NFD').
const COMBINING_DIACRITICS_RANGE_START = 0x0300
const COMBINING_DIACRITICS_RANGE_END = 0x036f

function stripCombiningDiacritics(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < COMBINING_DIACRITICS_RANGE_START || code > COMBINING_DIACRITICS_RANGE_END) out += ch
  }
  return out
}

// trim + repli des accents (NFD puis suppression des marques combinantes) + casse selon `caseSensitive`.
function normalize(value: string, caseSensitive: boolean): string {
  const folded = stripCombiningDiacritics(value.trim().normalize('NFD'))
  return caseSensitive ? folded : folded.toLowerCase()
}

export const text: QuestionTypeDef<TextPayload, TextAnswer> = {
  key: 'text',
  validatePayload: (raw) => textSchema.parse(raw),
  validateAnswer: (raw) => answerSchema.parse(raw),
  playerView: () => ({}), // pas de `answers`
  isCorrect: (p, a) => {
    const given = normalize(a.text, p.caseSensitive)
    return p.answers.some((candidate) => normalize(candidate, p.caseSensitive) === given)
  },
  score: (p, a, o) => (text.isCorrect(p, a) ? speedBonus(o.basePoints, o.timeMs, o.maxMs) : 0),
}
