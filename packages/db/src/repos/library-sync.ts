import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { CatalogSnapshot } from '@splootlabs/library'
import type { Db } from '../client.js'
import * as schema from '../schema.js'

const { libraryTheme, libraryQuestion, libraryQuiz, libraryQuizQuestion } = schema

// Taille de lot pour les insertions (limite de paramètres du protocole Postgres).
const CHUNK = 500

/** Minuscules sans diacritiques (NFD puis retrait des marques combinantes). Sert à stocker
 * `prompt_search` et à normaliser le terme de recherche côté lecture. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/** Synchronise la base avec l'instantané du catalogue, dans une seule transaction sérialisée par
 * un verrou consultatif (plusieurs instances du serveur peuvent démarrer en même temps). À appeler
 * avec la connexion privilégiée : app_role n'a que SELECT sur les tables `library_*`. */
export async function syncLibrary(
  db: Db,
  snapshot: CatalogSnapshot,
): Promise<{ themes: number; questions: number; quizzes: number; deleted: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pengou_library_sync'))`)
    const now = new Date()

    for (const part of chunks(snapshot.themes)) {
      await tx.insert(libraryTheme).values(part).onConflictDoUpdate({
        target: libraryTheme.id,
        set: {
          label: sql`excluded.label`, hidden: sql`excluded.hidden`, origin: sql`excluded.origin`,
        },
      })
    }

    for (const part of chunks(snapshot.questions)) {
      await tx.insert(libraryQuestion).values(part.map((q) => ({
        id: q.id, type: q.type, prompt: q.prompt, promptSearch: normalizeSearch(q.prompt),
        payload: q.payload, themeId: q.theme, difficulty: q.difficulty, language: q.language,
        audience: q.audience, timeLimit: q.timeLimit, readingTime: q.readingTime, source: q.source,
        origin: q.origin, originFile: q.originFile, updatedAt: now,
      }))).onConflictDoUpdate({
        target: libraryQuestion.id,
        set: {
          type: sql`excluded.type`, prompt: sql`excluded.prompt`,
          promptSearch: sql`excluded.prompt_search`, payload: sql`excluded.payload`,
          themeId: sql`excluded.theme_id`, difficulty: sql`excluded.difficulty`,
          language: sql`excluded.language`, audience: sql`excluded.audience`,
          timeLimit: sql`excluded.time_limit`, readingTime: sql`excluded.reading_time`,
          source: sql`excluded.source`, origin: sql`excluded.origin`,
          originFile: sql`excluded.origin_file`, updatedAt: sql`excluded.updated_at`,
        },
      })
    }

    for (const part of chunks(snapshot.quizzes)) {
      await tx.insert(libraryQuiz).values(part.map((z) => ({
        id: z.id, title: z.title, description: z.description, themeId: z.theme,
        difficulty: z.difficulty, language: z.language, audience: z.audience, source: z.source,
        origin: z.origin, originFile: z.originFile, updatedAt: now,
      }))).onConflictDoUpdate({
        target: libraryQuiz.id,
        set: {
          title: sql`excluded.title`, description: sql`excluded.description`,
          themeId: sql`excluded.theme_id`, difficulty: sql`excluded.difficulty`,
          language: sql`excluded.language`, audience: sql`excluded.audience`,
          source: sql`excluded.source`, origin: sql`excluded.origin`,
          originFile: sql`excluded.origin_file`, updatedAt: sql`excluded.updated_at`,
        },
      })
    }

    // Ordre des questions : on remplace les liaisons des quiz upsertés.
    const quizIds = snapshot.quizzes.map((z) => z.id)
    for (const part of chunks(quizIds)) {
      await tx.delete(libraryQuizQuestion).where(inArray(libraryQuizQuestion.quizId, part))
    }
    const links = snapshot.quizzes.flatMap((z) =>
      z.questionIds.map((questionId, position) => ({ quizId: z.id, questionId, position })))
    for (const part of chunks(links)) await tx.insert(libraryQuizQuestion).values(part)

    // Suppression des lignes retirées, hors fichiers écartés (leurs lignes sont conservées).
    const origins = ['builtin', 'instance'] as const
    let deleted = 0
    const stale = (table: typeof libraryQuestion | typeof libraryQuiz, ids: string[]) => and(
      inArray(table.origin, [...origins]),
      ids.length ? notInArray(table.id, ids) : undefined,
      snapshot.rejectedFiles.length ? notInArray(table.originFile, snapshot.rejectedFiles) : undefined,
    )
    const delQuizzes = await tx.delete(libraryQuiz)
      .where(stale(libraryQuiz, quizIds)).returning({ id: libraryQuiz.id })
    const delQuestions = await tx.delete(libraryQuestion)
      .where(stale(libraryQuestion, snapshot.questions.map((q) => q.id))).returning({ id: libraryQuestion.id })
    deleted += delQuizzes.length + delQuestions.length

    // Thèmes absents de l'instantané : supprimés seulement s'ils ne sont plus référencés
    // (une ligne gardée d'un fichier écarté peut encore en dépendre).
    const themeIds = snapshot.themes.map((t) => t.id)
    const delThemes = await tx.delete(libraryTheme).where(and(
      inArray(libraryTheme.origin, [...origins]),
      themeIds.length ? notInArray(libraryTheme.id, themeIds) : undefined,
      sql`not exists (select 1 from ${libraryQuestion} where ${libraryQuestion.themeId} = ${libraryTheme.id})`,
      sql`not exists (select 1 from ${libraryQuiz} where ${libraryQuiz.themeId} = ${libraryTheme.id})`,
    )).returning({ id: libraryTheme.id })
    deleted += delThemes.length

    return { themes: snapshot.themes.length, questions: snapshot.questions.length, quizzes: snapshot.quizzes.length, deleted }
  })
}
