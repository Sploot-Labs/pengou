import { and, asc, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm'
import type { Audience, Difficulty } from '@splootlabs/library'
import type { Db } from '../client.js'
import * as schema from '../schema.js'
import type { ContentSource } from '@splootlabs/library'
import { normalizeSearch } from './library-sync.js'

const { libraryTheme, libraryQuestion, libraryQuiz, libraryQuizQuestion } = schema

export type LibraryFilters = {
  theme?: string
  difficulty?: Difficulty
  language?: string
  audience?: Audience
  search?: string
}

export type LibraryQuestion = {
  id: string
  type: typeof libraryQuestion.$inferSelect['type']
  prompt: string
  payload: unknown
  theme: string
  difficulty: Difficulty
  language: string
  audience: Audience
  timeLimit: number
  readingTime: number
  source: ContentSource
}

export type LibraryQuizSummary = {
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

// Colonnes d'une question du catalogue, dans la forme exposée par `LibraryQuestion`.
const questionColumns = {
  id: libraryQuestion.id,
  type: libraryQuestion.type,
  prompt: libraryQuestion.prompt,
  payload: libraryQuestion.payload,
  theme: libraryQuestion.themeId,
  difficulty: libraryQuestion.difficulty,
  language: libraryQuestion.language,
  audience: libraryQuestion.audience,
  timeLimit: libraryQuestion.timeLimit,
  readingTime: libraryQuestion.readingTime,
  source: libraryQuestion.source,
}

// Compte des questions d'un quiz dans la jointure de liaison.
const questionCount = sql<number>`(select count(*) from ${libraryQuizQuestion} where ${libraryQuizQuestion.quizId} = ${libraryQuiz.id})`.mapWith(Number)

const quizColumns = {
  id: libraryQuiz.id,
  title: libraryQuiz.title,
  description: libraryQuiz.description,
  theme: libraryQuiz.themeId,
  difficulty: libraryQuiz.difficulty,
  language: libraryQuiz.language,
  audience: libraryQuiz.audience,
  source: libraryQuiz.source,
  questionCount,
}

/** Échappe `%`, `_` et `\` pour un `like ... escape '\'`. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// `enfants` et `adultes` incluent aussi `tous`.
function audienceFilter(column: typeof libraryQuestion.audience | typeof libraryQuiz.audience, audience: Audience): SQL | undefined {
  return audience === 'tous' ? eq(column, 'tous') : or(eq(column, audience), eq(column, 'tous'))
}

function questionWhere(filters: LibraryFilters, extra: (SQL | undefined)[] = []): SQL | undefined {
  const search = filters.search ? normalizeSearch(filters.search.trim()) : ''
  return and(
    eq(libraryTheme.hidden, false),
    filters.theme ? eq(libraryQuestion.themeId, filters.theme) : undefined,
    filters.difficulty ? eq(libraryQuestion.difficulty, filters.difficulty) : undefined,
    filters.language ? eq(libraryQuestion.language, filters.language) : undefined,
    filters.audience ? audienceFilter(libraryQuestion.audience, filters.audience) : undefined,
    search ? sql`${libraryQuestion.promptSearch} like ${`%${escapeLike(search)}%`} escape '\\'` : undefined,
    ...extra,
  )
}

function quizWhere(filters: Omit<LibraryFilters, 'search'>, extra: (SQL | undefined)[] = []): SQL | undefined {
  return and(
    eq(libraryTheme.hidden, false),
    filters.theme ? eq(libraryQuiz.themeId, filters.theme) : undefined,
    filters.difficulty ? eq(libraryQuiz.difficulty, filters.difficulty) : undefined,
    filters.language ? eq(libraryQuiz.language, filters.language) : undefined,
    filters.audience ? audienceFilter(libraryQuiz.audience, filters.audience) : undefined,
    ...extra,
  )
}

/** Thèmes visibles, triés par libellé. */
export async function listLibraryThemes(db: Db): Promise<{ id: string; label: string }[]> {
  return db.select({ id: libraryTheme.id, label: libraryTheme.label })
    .from(libraryTheme).where(eq(libraryTheme.hidden, false)).orderBy(asc(libraryTheme.label))
}

/** Langues présentes dans les questions des thèmes visibles. */
export async function listLibraryLanguages(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ language: libraryQuestion.language })
    .from(libraryQuestion)
    .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuestion.themeId))
    .where(eq(libraryTheme.hidden, false))
    .orderBy(asc(libraryQuestion.language))
  return rows.map((r) => r.language)
}

export async function searchLibraryQuestions(
  db: Db,
  filters: LibraryFilters,
  page: { offset: number; limit: number },
): Promise<{ items: LibraryQuestion[]; total: number }> {
  const where = questionWhere(filters)
  const [items, [{ total }]] = await Promise.all([
    db.select(questionColumns).from(libraryQuestion)
      .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuestion.themeId))
      .where(where).orderBy(asc(libraryQuestion.id)).limit(page.limit).offset(page.offset),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(libraryQuestion)
      .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuestion.themeId))
      .where(where),
  ])
  return { items, total }
}

export async function listLibraryQuizzes(
  db: Db,
  filters: Omit<LibraryFilters, 'search'>,
): Promise<LibraryQuizSummary[]> {
  return db.select(quizColumns).from(libraryQuiz)
    .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuiz.themeId))
    .where(quizWhere(filters)).orderBy(asc(libraryQuiz.title), asc(libraryQuiz.id))
}

/** Tirage aléatoire sans doublon, hors `excludeIds`. Renvoie moins de `count` si le catalogue
 * n'en contient pas assez. */
export async function drawLibraryQuestions(
  db: Db,
  filters: LibraryFilters,
  count: number,
  excludeIds: string[],
): Promise<LibraryQuestion[]> {
  return db.select(questionColumns).from(libraryQuestion)
    .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuestion.themeId))
    .where(questionWhere(filters, [excludeIds.length ? notInArray(libraryQuestion.id, excludeIds) : undefined]))
    .orderBy(sql`random()`).limit(count)
}

/** Questions dans l'ordre de `ids`, ou `null` si l'une est inconnue ou masquée. */
export async function getLibraryQuestions(db: Db, ids: string[]): Promise<LibraryQuestion[] | null> {
  if (ids.length === 0) return []
  const rows = await db.select(questionColumns).from(libraryQuestion)
    .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuestion.themeId))
    .where(and(eq(libraryTheme.hidden, false), inArray(libraryQuestion.id, ids)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered: LibraryQuestion[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) return null
    ordered.push(row)
  }
  return ordered
}

export async function getLibraryQuiz(
  db: Db,
  id: string,
): Promise<{ quiz: LibraryQuizSummary; questions: LibraryQuestion[] } | null> {
  const [quiz] = await db.select(quizColumns).from(libraryQuiz)
    .innerJoin(libraryTheme, eq(libraryTheme.id, libraryQuiz.themeId))
    .where(quizWhere({}, [eq(libraryQuiz.id, id)]))
  if (!quiz) return null
  const questions = await db.select(questionColumns).from(libraryQuizQuestion)
    .innerJoin(libraryQuestion, eq(libraryQuestion.id, libraryQuizQuestion.questionId))
    .where(eq(libraryQuizQuestion.quizId, id))
    .orderBy(asc(libraryQuizQuestion.position))
  return { quiz, questions }
}
