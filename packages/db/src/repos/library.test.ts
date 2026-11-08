import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { CatalogSnapshot, SnapshotQuestion, SnapshotQuiz } from '@splootlabs/library'
import { startTestDb } from '../test-helpers.js'
import { runMigrations } from '../migrate.js'
import { syncLibrary } from './library-sync.js'
import {
  listLibraryThemes,
  listLibraryLanguages,
  searchLibraryQuestions,
  listLibraryQuizzes,
  drawLibraryQuestions,
  getLibraryQuestions,
  getLibraryQuiz,
} from './library.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

const source = { name: 'Test', license: 'CC0' }

function q(id: string, over: Partial<SnapshotQuestion> = {}): SnapshotQuestion {
  return {
    id,
    type: 'truefalse',
    prompt: `Énoncé ${id} ?`,
    payload: { answer: true },
    theme: 'sciences',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    timeLimit: 20,
    readingTime: 6,
    source,
    origin: 'builtin',
    originFile: 'builtin/a.json',
    ...over,
  }
}

function quiz(id: string, questionIds: string[], over: Partial<SnapshotQuiz> = {}): SnapshotQuiz {
  return {
    id,
    title: `Quiz ${id}`,
    description: null,
    theme: 'sciences',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    questionIds,
    source,
    origin: 'builtin',
    originFile: 'builtin/a.json',
    ...over,
  }
}

const snapshot: CatalogSnapshot = {
  themes: [
    { id: 'sciences', label: 'Sciences', hidden: false, origin: 'builtin' },
    { id: 'arts', label: 'Arts', hidden: false, origin: 'builtin' },
    { id: 'secret', label: 'Secret', hidden: true, origin: 'instance' },
  ],
  questions: [
    q('q1'),
    q('q2', { theme: 'arts', difficulty: 'difficile', prompt: 'Quel film de Cinéma ?', language: 'en' }),
    q('q3', { difficulty: 'moyen', audience: 'enfants', prompt: 'Remise de 100% ?' }),
    q('q4', { difficulty: 'moyen', audience: 'adultes', prompt: 'Remise de 1000 ?' }),
    q('q5', { theme: 'secret' }),
    q('q6', { theme: 'secret' }),
  ],
  quizzes: [
    quiz('z1', ['q3', 'q1', 'q2'], { title: 'Zèbre' }),
    quiz('z2', ['q1', 'q5'], { title: 'Abeille', audience: 'adultes' }),
    quiz('z3', ['q5'], { theme: 'secret' }),
    quiz('z4', ['q5', 'q6']),
  ],
  rejectedFiles: [],
}

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  await syncLibrary(ctx.db, snapshot)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

const page = { offset: 0, limit: 50 }

describe('lecture du catalogue', () => {
  it('liste les thèmes visibles triés par libellé et les langues', async () => {
    expect(await listLibraryThemes(ctx.db)).toEqual([
      { id: 'arts', label: 'Arts' },
      { id: 'sciences', label: 'Sciences' },
    ])
    expect(await listLibraryLanguages(ctx.db)).toEqual(['en', 'fr'])
  })

  it('combine les filtres thème et difficulté', async () => {
    const res = await searchLibraryQuestions(ctx.db, { theme: 'sciences', difficulty: 'moyen' }, page)
    expect(res.items.map((i) => i.id)).toEqual(['q3', 'q4'])
    expect(res.total).toBe(2)
    expect(res.items[0]).toMatchObject({ theme: 'sciences', source, timeLimit: 20, readingTime: 6 })
  })

  it('cherche sans tenir compte des accents et sans joker', async () => {
    expect((await searchLibraryQuestions(ctx.db, { search: 'cinema' }, page)).items.map((i) => i.id)).toEqual(['q2'])
    expect((await searchLibraryQuestions(ctx.db, { search: '100%' }, page)).items.map((i) => i.id)).toEqual(['q3'])
    expect((await searchLibraryQuestions(ctx.db, { search: 'remise de 1__' }, page)).total).toBe(0)
  })

  it('le filtre enfants inclut tous mais pas adultes', async () => {
    const res = await searchLibraryQuestions(ctx.db, { audience: 'enfants' }, page)
    const ids = res.items.map((i) => i.id)
    expect(ids).toContain('q3')
    expect(ids).toContain('q1')
    expect(ids).not.toContain('q4')
  })

  it('pagine sans changer le total', async () => {
    const res = await searchLibraryQuestions(ctx.db, {}, { offset: 1, limit: 2 })
    expect(res.total).toBe(4)
    expect(res.items.length).toBeLessThanOrEqual(2)
    expect(res.items.map((i) => i.id)).toEqual(['q2', 'q3'])
  })

  it('masque les thèmes cachés partout', async () => {
    const all = await searchLibraryQuestions(ctx.db, {}, page)
    expect(all.items.some((i) => i.id === 'q5')).toBe(false)
    expect((await listLibraryQuizzes(ctx.db, {})).some((z) => z.id === 'z3')).toBe(false)
    expect(await getLibraryQuiz(ctx.db, 'z3')).toBeNull()
    expect(await getLibraryQuestions(ctx.db, ['q1', 'q5'])).toBeNull()
    expect((await drawLibraryQuestions(ctx.db, {}, 100, [])).some((i) => i.id === 'q5')).toBe(false)
  })

  it('ignore un quiz visible dont toutes les questions sont masquées', async () => {
    expect((await listLibraryQuizzes(ctx.db, {})).some((z) => z.id === 'z4')).toBe(false)
    expect(await getLibraryQuiz(ctx.db, 'z4')).toBeNull()
  })

  it('liste les quiz triés par titre avec leur nombre de questions', async () => {
    const list = await listLibraryQuizzes(ctx.db, {})
    expect(list.map((z) => [z.title, z.questionCount])).toEqual([
      ['Abeille', 1],
      ['Zèbre', 3],
    ])
    expect((await listLibraryQuizzes(ctx.db, { audience: 'adultes' })).map((z) => z.id)).toEqual(['z2', 'z1'])
  })

  it('tire au hasard sans doublon ni id exclu, et renvoie tout le disponible', async () => {
    const res = await drawLibraryQuestions(ctx.db, {}, 100, ['q1'])
    const ids = res.map((i) => i.id).sort()
    expect(ids).toEqual(['q2', 'q3', 'q4'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("getLibraryQuestions conserve l'ordre demandé et renvoie null si un id est inconnu", async () => {
    expect((await getLibraryQuestions(ctx.db, ['q3', 'q1']))?.map((i) => i.id)).toEqual(['q3', 'q1'])
    expect(await getLibraryQuestions(ctx.db, ['q1', 'nope'])).toBeNull()
    expect(await getLibraryQuestions(ctx.db, [])).toEqual([])
  })

  it("getLibraryQuiz renvoie les questions dans l'ordre de position", async () => {
    const res = await getLibraryQuiz(ctx.db, 'z1')
    expect(res?.quiz).toMatchObject({ id: 'z1', title: 'Zèbre', questionCount: 3 })
    expect(res?.questions.map((i) => i.id)).toEqual(['q3', 'q1', 'q2'])
    expect(await getLibraryQuiz(ctx.db, 'inconnu')).toBeNull()
  })

  it("exclut les questions d'un thème masqué d'un quiz visible", async () => {
    const res = await getLibraryQuiz(ctx.db, 'z2')
    expect(res?.questions.map((i) => i.id)).toEqual(['q1'])
    expect(res?.quiz.questionCount).toBe(1)
    expect((await listLibraryQuizzes(ctx.db, {})).find((z) => z.id === 'z2')?.questionCount).toBe(1)
  })

  it('fonctionne avec le rôle restreint appDb', async () => {
    const res = await searchLibraryQuestions(ctx.appDb, { theme: 'arts' }, page)
    expect(res.items.map((i) => i.id)).toEqual(['q2'])
  })
})
