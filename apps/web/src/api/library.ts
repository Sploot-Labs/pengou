/**
 * Client de la bibliothèque de questions. Les types miroirs reprennent à la
 * main ceux de `packages/db/src/repos/library.ts` et les formes de réponse de
 * `apps/server/src/routes/library.ts` (le web ne dépend pas des paquets serveur).
 */
import { apiGet, apiPost } from './client'
import type { ContentSource, Question, QuestionType, Quiz } from './quizzes'

export type Difficulty = 'facile' | 'moyen' | 'difficile'
export type Audience = 'enfants' | 'adultes' | 'tous'

export interface LibraryQuestion {
  id: string
  type: QuestionType
  prompt: string
  payload: Question['payload']
  theme: string
  difficulty: Difficulty
  language: string
  audience: Audience
  timeLimit: number
  readingTime: number
  source: ContentSource
}

export interface LibraryQuizSummary {
  id: string
  title: string
  description: string | null
  theme: string
  difficulty: Difficulty
  language: string
  audience: Audience
  source: ContentSource
  questionCount: number
}

export interface LibraryFilters {
  theme?: string
  difficulty?: Difficulty
  language?: string
  audience?: Audience
  search?: string
}

export interface LibraryMeta {
  themes: { id: string; label: string }[]
  difficulties: Difficulty[]
  audiences: Audience[]
  languages: string[]
}

export interface LibraryPage {
  offset: number
  limit: number
}

/** Filtres vides ou absents écartés : jamais envoyés au serveur. */
function cleanFilters(filters: LibraryFilters): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString()
  return qs ? `${path}?${qs}` : path
}

export function getLibraryMeta(): Promise<LibraryMeta> {
  return apiGet<LibraryMeta>('/api/library/meta')
}

export function listLibraryQuizzes(filters: Omit<LibraryFilters, 'search'>): Promise<LibraryQuizSummary[]> {
  return apiGet<LibraryQuizSummary[]>(withQuery('/api/library/quizzes', cleanFilters(filters)))
}

export function listLibraryQuestions(
  filters: LibraryFilters,
  page: LibraryPage,
): Promise<{ items: LibraryQuestion[]; total: number }> {
  const params = { ...cleanFilters(filters), offset: String(page.offset), limit: String(page.limit) }
  return apiGet<{ items: LibraryQuestion[]; total: number }>(withQuery('/api/library/questions', params))
}

/** Tirage aléatoire : renvoie directement le tableau `items` de la réponse. */
export async function drawLibraryQuestions(
  filters: LibraryFilters,
  count: number,
  excludeIds: string[],
): Promise<LibraryQuestion[]> {
  const res = await apiPost<{ items: LibraryQuestion[] }>('/api/library/draw', {
    filters: cleanFilters(filters),
    count,
    excludeIds,
  })
  return res.items
}

export function duplicateLibraryQuiz(id: string): Promise<Quiz> {
  return apiPost<Quiz>(`/api/library/quizzes/${encodeURIComponent(id)}/duplicate`)
}

export function composeQuiz(title: string, questionIds: string[]): Promise<Quiz> {
  return apiPost<Quiz>('/api/library/compose', { title, questionIds })
}
