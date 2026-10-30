/**
 * Typed wrappers for the quiz/question REST CRUD (Plan 06 Task 3). Row shapes
 * mirror exactly what `apps/server/src/routes/{quizzes,questions}.ts` and
 * `packages/db/src/repos/{quiz,question}.ts` send/accept — verified by
 * reading those files, not guessed. Payload shapes mirror the per-type zod
 * schemas in `packages/quiz/src/{mcq,truefalse,text,slider}.ts`.
 *
 * Notably: there is no `points`/`basePoints` field anywhere in this contract
 * (the `question` table has no such column) — see `HostEditor.tsx` for how
 * that affects the editor UI.
 */
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './client'

/** Attribution d'un contenu issu de la bibliothèque (copie conservée sur le quiz et ses questions). */
export interface ContentSource {
  name: string
  license: string
  url?: string
}

export type QuestionType = 'mcq' | 'truefalse' | 'text' | 'slider'

export interface Quiz {
  id: string
  tenantId: string
  ownerId: string
  title: string
  description: string | null
  cover: string | null
  source: ContentSource | null
  createdAt: string
  updatedAt: string
}

/** `Quiz` + `questionCount` (Task 6) — what `GET /api/quizzes` actually
 * returns (see `listQuizzes` in `packages/db/src/repos/quiz.ts`), as a
 * list-only shape so it doesn't pollute the base `Quiz` type used
 * elsewhere (single-quiz fetch/create/update responses have no such field). */
export type QuizListItem = Quiz & { questionCount: number }

export interface McqOption {
  label: string
  correct: boolean
}
export interface McqPayload {
  options: McqOption[]
}
export interface TrueFalsePayload {
  correct: boolean
}
export interface TextPayload {
  answers: string[]
  caseSensitive?: boolean
}
export interface SliderPayload {
  min: number
  max: number
  correct: number
  step?: number
}

export type QuestionPayload = McqPayload | TrueFalsePayload | TextPayload | SliderPayload

export interface Question {
  id: string
  quizId: string
  type: QuestionType
  prompt: string
  media: string | null
  timeLimit: number
  readingTime: number
  orderIndex: number
  payload: QuestionPayload
  source: ContentSource | null
  createdAt: string
}

export interface CreateQuizInput {
  title: string
  description?: string
}

export interface UpdateQuizInput {
  title?: string
  description?: string | null
  cover?: string | null
}

export interface CreateQuestionInput {
  type: QuestionType
  prompt: string
  timeLimit: number
  readingTime?: number
  payload: QuestionPayload
  media?: string
}

export interface UpdateQuestionInput {
  prompt?: string
  timeLimit?: number
  readingTime?: number
  payload?: QuestionPayload
  media?: string | null
}

export function listQuizzes(): Promise<QuizListItem[]> {
  return apiGet<QuizListItem[]>('/api/quizzes')
}

export function createQuiz(input: CreateQuizInput): Promise<Quiz> {
  return apiPost<Quiz>('/api/quizzes', input)
}

export function getQuiz(id: string): Promise<Quiz> {
  return apiGet<Quiz>(`/api/quizzes/${id}`)
}

export function updateQuiz(id: string, patch: UpdateQuizInput): Promise<Quiz> {
  return apiPatch<Quiz>(`/api/quizzes/${id}`, patch)
}

export function deleteQuiz(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/quizzes/${id}`)
}

export function listQuestions(quizId: string): Promise<Question[]> {
  return apiGet<Question[]>(`/api/quizzes/${quizId}/questions`)
}

export function createQuestion(quizId: string, input: CreateQuestionInput): Promise<Question> {
  return apiPost<Question>(`/api/quizzes/${quizId}/questions`, input)
}

export function updateQuestion(
  quizId: string,
  questionId: string,
  patch: UpdateQuestionInput,
): Promise<Question> {
  return apiPatch<Question>(`/api/quizzes/${quizId}/questions/${questionId}`, patch)
}

/** 204 No Content on success — nothing to type beyond `void`. */
export function deleteQuestion(quizId: string, questionId: string): Promise<void> {
  return apiDelete<void>(`/api/quizzes/${quizId}/questions/${questionId}`)
}

/** Sends the FULL ordered id list — the server rejects a partial set (any id
 * in `orderedIds` that doesn't match an existing question of this quiz makes
 * the whole call fail, see `reorderQuestions` in `packages/db`). */
export function reorderQuestions(quizId: string, orderedIds: string[]): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>(`/api/quizzes/${quizId}/questions/order`, { orderedIds })
}
