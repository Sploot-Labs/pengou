import { z } from 'zod'
import type { QuestionType } from '@splootlabs/quiz'

// Bornes alignées sur apps/server/src/validation.ts (LIMITS.prompt, title, description).
const PROMPT_MAX = 500
const TITLE_MAX = 200
const DESCRIPTION_MAX = 2000

export type Difficulty = 'facile' | 'moyen' | 'difficile'
export type Audience = 'enfants' | 'adultes' | 'tous'
export type Origin = 'builtin' | 'instance'
export type ContentSource = { name: string; license: string; url?: string }
export type Theme = { id: string; label: string }

export type SnapshotTheme = { id: string; label: string; hidden: boolean; origin: Origin }

export type SnapshotQuestion = {
  id: string
  type: QuestionType
  prompt: string
  payload: unknown
  theme: string
  difficulty: Difficulty
  language: string
  audience: Audience
  timeLimit: number
  readingTime: number
  source: ContentSource
  origin: Origin
  originFile: string
}

export type SnapshotQuiz = {
  id: string
  title: string
  description: string | null
  theme: string
  difficulty: Difficulty
  language: string
  audience: Audience
  questionIds: string[]
  source: ContentSource
  origin: Origin
  originFile: string
}

export type CatalogSnapshot = {
  themes: SnapshotTheme[]
  questions: SnapshotQuestion[]
  quizzes: SnapshotQuiz[]
  rejectedFiles: string[]
}

export const DEFAULT_TIME_LIMIT = 20
export const DEFAULT_READING_TIME = 6

const idSchema = z.string().min(1).max(100)
const difficultySchema = z.enum(['facile', 'moyen', 'difficile'])
const audienceSchema = z.enum(['enfants', 'adultes', 'tous'])
// Code ISO 639-1 en minuscules.
const languageSchema = z.string().regex(/^[a-z]{2}$/)

export const themeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  label: z.string().min(1).max(100),
})

export const builtinThemesSchema = z.array(themeSchema)

export const instanceThemesSchema = z.strictObject({
  add: z.array(themeSchema).optional(),
  relabel: z.record(z.string(), z.string().min(1).max(100)).optional(),
  hide: z.array(z.string()).optional(),
})

const sourceSchema = z.strictObject({
  name: z.string().min(1).max(200),
  license: z.string().min(1).max(200),
  url: z.string().min(1).max(500).optional(),
})

const questionSchema = z.strictObject({
  id: idSchema,
  type: z.enum(['mcq', 'truefalse', 'text', 'slider']),
  prompt: z.string().min(1).max(PROMPT_MAX),
  payload: z.unknown(),
  theme: z.string().min(1),
  difficulty: difficultySchema,
  language: languageSchema,
  audience: audienceSchema,
  timeLimit: z.number().int().positive().optional(),
  readingTime: z.number().int().nonnegative().optional(),
})

const quizSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  theme: z.string().min(1),
  difficulty: difficultySchema,
  language: languageSchema,
  audience: audienceSchema,
  questionIds: z.array(idSchema).min(1),
})

export const packSchema = z.strictObject({
  source: sourceSchema,
  questions: z.array(questionSchema),
  quizzes: z.array(quizSchema),
})

export type Pack = z.infer<typeof packSchema>
