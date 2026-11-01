import type { Pack } from './schema.js'

export type QuestionTranslation = { prompt: string; options?: string[] } | { skip: string }
export type TranslationTable = {
  questions: Record<string, QuestionTranslation>
  quizzes: Record<string, { title: string; description?: string }>
}
export type TranslateResult = { pack: Pack | null; missing: string[]; skippedQuizzes: string[] }

type Option = { label: string; correct: boolean }

// Fusionne des tables de traduction ; une clé présente dans deux tables est une erreur.
export function mergeTables(tables: TranslationTable[]): TranslationTable {
  const merged: TranslationTable = { questions: {}, quizzes: {} }
  for (const table of tables) {
    for (const kind of ['questions', 'quizzes'] as const) {
      for (const [key, value] of Object.entries(table[kind])) {
        if (Object.hasOwn(merged[kind], key)) throw new Error(`clé en double dans les tables (${kind}) : ${key}`)
        ;(merged[kind] as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

// Traduit un QCM : les propositions suivent l'ordre de l'original, `correct` est recopié.
function translatePayload(id: string, payload: unknown, options: string[] | undefined): unknown {
  if (!options) return payload
  const original = (payload as { options?: Option[] }).options
  if (!original) throw new Error(`${id} : « options » fourni pour une question sans propositions`)
  if (original.length !== options.length) {
    throw new Error(`${id} : ${options.length} propositions traduites pour ${original.length} dans l'original`)
  }
  return { ...(payload as object), options: original.map((o, i) => ({ label: options[i], correct: o.correct })) }
}

export function translatePack(pack: Pack, table: TranslationTable, lang: string): TranslateResult {
  const missing: string[] = []
  const skipped = new Set<string>()
  const translated = new Set<string>()
  const questions: Pack['questions'] = []
  for (const q of pack.questions) {
    const entry = Object.hasOwn(table.questions, q.id) ? table.questions[q.id] : undefined
    if (!entry) {
      missing.push(q.id)
    } else if ('skip' in entry) {
      skipped.add(q.id)
    } else {
      if (q.type === 'mcq' && !entry.options) throw new Error(`${q.id} : « options » manquant pour un QCM`)
      translated.add(q.id)
      questions.push({
        ...q,
        id: `${q.id}-${lang}`,
        prompt: entry.prompt,
        payload: translatePayload(q.id, q.payload, entry.options),
        language: lang,
      })
    }
  }

  const quizzes: Pack['quizzes'] = []
  const skippedQuizzes: string[] = []
  for (const quiz of pack.quizzes) {
    if (quiz.questionIds.some((id) => skipped.has(id))) {
      skippedQuizzes.push(quiz.id)
      continue
    }
    // Un quiz qui référence des questions hors de ce pack n'est pas reproduit.
    if (!quiz.questionIds.every((id) => translated.has(id))) continue
    const entry = Object.hasOwn(table.quizzes, quiz.id) ? table.quizzes[quiz.id] : undefined
    if (!entry) {
      missing.push(quiz.id)
      continue
    }
    const { description: _description, ...rest } = quiz
    quizzes.push({
      ...rest,
      id: `${quiz.id}-${lang}`,
      title: entry.title,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      language: lang,
      questionIds: quiz.questionIds.map((id) => `${id}-${lang}`),
    })
  }

  if (questions.length === 0) return { pack: null, missing, skippedQuizzes }
  const source = { ...pack.source, name: `${pack.source.name} (traduction Sploot Labs)` }
  return { pack: { source, questions, quizzes }, missing, skippedQuizzes }
}
