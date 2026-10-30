import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import type { CatalogSnapshot, SnapshotQuestion, SnapshotQuiz } from '@splootlabs/library'
import { startTestDb } from '../test-helpers.js'
import { runMigrations } from '../migrate.js'
import { schema } from '../index.js'
import { tenantScope } from '../tenant.js'
import { createQuiz } from './quiz.js'
import { syncLibrary, normalizeSearch } from './library-sync.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => { await ctx?.stop() })

const source = { name: 'Test', license: 'CC0' }

function q(id: string, over: Partial<SnapshotQuestion> = {}): SnapshotQuestion {
  return {
    id, type: 'truefalse', prompt: `Énoncé ${id} ?`, payload: { answer: true }, theme: 'sciences',
    difficulty: 'facile', language: 'fr', audience: 'tous', timeLimit: 20, readingTime: 6,
    source, origin: 'builtin', originFile: 'builtin/a.json', ...over,
  }
}

function quiz(id: string, questionIds: string[], over: Partial<SnapshotQuiz> = {}): SnapshotQuiz {
  return {
    id, title: `Quiz ${id}`, description: null, theme: 'sciences', difficulty: 'facile', language: 'fr',
    audience: 'tous', questionIds, source, origin: 'builtin', originFile: 'builtin/a.json', ...over,
  }
}

function snap(over: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    themes: [{ id: 'sciences', label: 'Sciences', hidden: false, origin: 'builtin' }],
    questions: [q('q1'), q('q2'), q('q3')],
    quizzes: [quiz('z1', ['q3', 'q1', 'q2'])],
    rejectedFiles: [],
    ...over,
  }
}

async function counts() {
  const [t, qs, z, zq] = await Promise.all([
    ctx.db.select().from(schema.libraryTheme),
    ctx.db.select().from(schema.libraryQuestion),
    ctx.db.select().from(schema.libraryQuiz),
    ctx.db.select().from(schema.libraryQuizQuestion),
  ])
  return { themes: t.length, questions: qs.length, quizzes: z.length, links: zq.length }
}

describe('syncLibrary', () => {
  it('insère thèmes, questions, quiz et leur ordre', async () => {
    const res = await syncLibrary(ctx.db, snap())
    expect(res).toMatchObject({ themes: 1, questions: 3, quizzes: 1, deleted: 0 })
    const links = await ctx.db.select().from(schema.libraryQuizQuestion)
      .where(eq(schema.libraryQuizQuestion.quizId, 'z1')).orderBy(schema.libraryQuizQuestion.position)
    expect(links.map((l) => l.questionId)).toEqual(['q3', 'q1', 'q2'])
    const [row] = await ctx.db.select().from(schema.libraryQuestion).where(eq(schema.libraryQuestion.id, 'q1'))
    expect(row.promptSearch).toBe('enonce q1 ?')
  })

  it('une seconde synchronisation identique ne change rien', async () => {
    await syncLibrary(ctx.db, snap())
    const res = await syncLibrary(ctx.db, snap())
    expect(res.deleted).toBe(0)
    expect(await counts()).toEqual({ themes: 1, questions: 3, quizzes: 1, links: 3 })
  })

  it('met à jour une question modifiée et supprime une question retirée', async () => {
    await syncLibrary(ctx.db, snap({
      questions: [q('q1', { prompt: 'Nouvel énoncé' }), q('q3')],
      quizzes: [quiz('z1', ['q3', 'q1'])],
    }))
    const [row] = await ctx.db.select().from(schema.libraryQuestion).where(eq(schema.libraryQuestion.id, 'q1'))
    expect(row.prompt).toBe('Nouvel énoncé')
    expect(row.promptSearch).toBe('nouvel enonce')
    const ids = (await ctx.db.select().from(schema.libraryQuestion)).map((r) => r.id).sort()
    expect(ids).toEqual(['q1', 'q3'])
    const links = await ctx.db.select().from(schema.libraryQuizQuestion)
    expect(links.filter((l) => l.quizId === 'z1')).toHaveLength(2)
  })

  it('conserve les lignes d\'un fichier rejeté', async () => {
    const inst = { origin: 'instance' as const, originFile: 'instance/x.json' }
    await syncLibrary(ctx.db, snap({ questions: [q('i1', inst)], quizzes: [] }))
    expect((await ctx.db.select().from(schema.libraryQuestion)).some((r) => r.id === 'i1')).toBe(true)
    await syncLibrary(ctx.db, snap({ themes: [], questions: [], quizzes: [], rejectedFiles: ['instance/x.json'] }))
    expect((await ctx.db.select().from(schema.libraryQuestion)).some((r) => r.id === 'i1')).toBe(true)
    // Le thème reste référencé par la question conservée : il n'est pas supprimé.
    const themes = await ctx.db.select().from(schema.libraryTheme)
    expect(themes.some((t) => t.id === 'sciences')).toBe(true)
    // Fichier plus rejeté et absent : suppression.
    await syncLibrary(ctx.db, snap({ questions: [], quizzes: [] }))
    expect((await ctx.db.select().from(schema.libraryQuestion)).some((r) => r.id === 'i1')).toBe(false)
  })

  it('deux synchronisations concurrentes réussissent', async () => {
    await Promise.all([syncLibrary(ctx.db, snap()), syncLibrary(ctx.db, snap())])
    expect(await counts()).toEqual({ themes: 1, questions: 3, quizzes: 1, links: 3 })
  })

  it('app_role peut lire mais pas écrire', async () => {
    const rows = await ctx.appDb.select().from(schema.libraryQuestion)
    expect(rows.length).toBe(3)
    await expect(ctx.appDb.insert(schema.libraryTheme).values({ id: 'x', label: 'X', origin: 'builtin' }))
      .rejects.toThrow()
  })

  it('quiz et question acceptent source', async () => {
    const [t] = await ctx.db.insert(schema.tenant).values({ name: 'T' }).returning()
    const [u] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'l@x.fr', name: 'L', emailVerified: false }).returning()
    const plain = await createQuiz(tenantScope(ctx.db, t.id), { ownerId: u.id, title: 'Sans source' })
    expect(plain.source).toBeNull()
    const [withSrc] = await ctx.db.update(schema.quiz).set({ source })
      .where(eq(schema.quiz.id, plain.id)).returning()
    expect(withSrc.source).toEqual(source)
  })
})

describe('normalizeSearch', () => {
  it('met en minuscules et retire les diacritiques', () => {
    expect(normalizeSearch('Été À LA Plage ç')).toBe('ete a la plage c')
  })
})
