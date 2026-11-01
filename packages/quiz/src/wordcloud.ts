import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'
import { normalizeText } from './text.js'

export const WORDCLOUD_MAX_WORD_LENGTH = 25
export const WORDCLOUD_MAX_WORDS_PER_PLAYER = 20

const collator = new Intl.Collator('fr')

export type WordcloudPayload = Record<string, never>

function cleanWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

const submissionSchema = z.object({
  word: z.string().transform(cleanWord).pipe(z.string().min(1).max(WORDCLOUD_MAX_WORD_LENGTH)),
})
export type WordcloudSubmission = z.infer<typeof submissionSchema>

/** Réponse stockée : tous les mots envoyés par un joueur pour la question. */
export type WordcloudAnswer = { words: string[] }
export type WordcloudWord = { key: string; text: string; count: number }
export type WordcloudAggregate = { words: WordcloudWord[]; participants: number; totalWords: number }

/** Clé de fusion : espaces internes réduits, puis casse et accents repliés. */
export function wordKey(word: string): string {
  return normalizeText(word.replace(/\s+/g, ' '), false)
}

export function aggregateWords(
  answers: WordcloudAnswer[],
  removedKeys: ReadonlySet<string>,
): WordcloudAggregate {
  // clé -> graphie affichée -> effectif
  const byKey = new Map<string, Map<string, number>>()
  let participants = 0
  let totalWords = 0
  for (const answer of answers) {
    let kept = 0
    for (const raw of answer.words) {
      const text = cleanWord(raw)
      const key = wordKey(text)
      if (key === '' || removedKeys.has(key)) continue
      kept++
      const spellings = byKey.get(key) ?? new Map<string, number>()
      spellings.set(text, (spellings.get(text) ?? 0) + 1)
      byKey.set(key, spellings)
    }
    if (kept > 0) participants++
    totalWords += kept
  }
  const words: WordcloudWord[] = []
  for (const [key, spellings] of byKey) {
    let text = ''
    let best = 0
    let count = 0
    for (const [spelling, n] of spellings) {
      count += n
      if (n > best || (n === best && collator.compare(spelling, text) < 0)) {
        text = spelling
        best = n
      }
    }
    words.push({ key, text, count })
  }
  words.sort((a, b) => b.count - a.count || collator.compare(a.text, b.text))
  return { words, participants, totalWords }
}

export const wordcloud: QuestionTypeDef<WordcloudPayload, WordcloudSubmission> = {
  key: 'wordcloud',
  scored: false,
  validatePayload: () => ({}),
  validateAnswer: (raw) => submissionSchema.parse(raw),
  playerView: () => ({}),
  isCorrect: () => false,
  score: () => 0,
}
