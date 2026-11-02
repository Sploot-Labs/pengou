import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'

const payloadSchema = z.object({
  options: z.array(z.object({ label: z.string().min(1).max(200) })).min(2).max(6),
  multiple: z.boolean().default(false),
})
export type PollPayload = { options: { label: string }[]; multiple: boolean }

const answerSchema = z.object({ optionIndexes: z.array(z.number().int().nonnegative()).min(1).max(6) })
export type PollAnswer = { optionIndexes: number[] }
export type PollTally = { votes: number[]; voters: number }

/** Cohérence d'une réponse avec le payload : indices distincts, dans les bornes, un seul en choix unique. */
export function pollAnswerError(payload: PollPayload, answer: PollAnswer): string | null {
  const indexes = answer.optionIndexes
  if (new Set(indexes).size !== indexes.length) return 'indices en double'
  if (indexes.some((i) => i >= payload.options.length)) return 'indice hors bornes'
  if (!payload.multiple && indexes.length !== 1) return 'une seule réponse attendue'
  return null
}

/** Décompte des votes par option ; un joueur sans indice valide n'est pas compté comme votant. */
export function tallyPoll(optionCount: number, answers: PollAnswer[]): PollTally {
  const votes = new Array<number>(optionCount).fill(0)
  let voters = 0
  for (const answer of answers) {
    let counted = false
    for (const i of new Set(answer.optionIndexes)) {
      if (i >= 0 && i < optionCount) {
        votes[i]++
        counted = true
      }
    }
    if (counted) voters++
  }
  return { votes, voters }
}

export function pollPercent(votes: number, voters: number): number {
  return voters === 0 ? 0 : Math.round((votes * 100) / voters)
}

export const poll: QuestionTypeDef<PollPayload, PollAnswer> = {
  key: 'poll',
  scored: false,
  validatePayload: (raw) => payloadSchema.parse(raw),
  validateAnswer: (raw) => answerSchema.parse(raw),
  playerView: (p) => ({ options: p.options.map((o) => ({ label: o.label })), multiple: p.multiple }),
  isCorrect: () => false,
  score: () => 0,
}
