import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCatalog } from './read.js'

const SOURCE = { name: 'Test', license: 'CC0' }

function question(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'truefalse',
    prompt: `Question ${id}`,
    payload: { correct: true },
    theme: 'cinema',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    ...extra,
  }
}

function quiz(id: string, questionIds: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Quiz ${id}`,
    theme: 'cinema',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    questionIds,
    ...extra,
  }
}

let root: string
let builtinDir: string
let extraDir: string

async function put(dir: string, rel: string, content: unknown) {
  const file = join(dir, rel)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'library-'))
  builtinDir = join(root, 'builtin')
  extraDir = join(root, 'extra')
  await put(builtinDir, 'themes.json', [
    { id: 'cinema', label: 'Cinéma' },
    { id: 'sport', label: 'Sport' },
  ])
  await put(builtinDir, 'a/pack.json', {
    source: SOURCE,
    questions: [question('b-1'), question('b-2', { timeLimit: 30, readingTime: 3 })],
    quizzes: [quiz('b-quiz', ['b-1', 'b-2'], { description: 'Desc' })],
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readCatalog', () => {
  it('lit un pack valide et applique les défauts', async () => {
    const snap = await readCatalog({ builtinDir })
    expect(snap.rejectedFiles).toEqual([])
    expect(snap.themes.map((t) => t.id)).toEqual(['cinema', 'sport'])
    expect(snap.themes[0]).toEqual({ id: 'cinema', label: 'Cinéma', hidden: false, origin: 'builtin' })
    const [q1, q2] = snap.questions
    expect(q1).toMatchObject({
      id: 'b-1',
      timeLimit: 20,
      readingTime: 6,
      source: SOURCE,
      origin: 'builtin',
      originFile: 'builtin:a/pack.json',
    })
    expect(q2).toMatchObject({ timeLimit: 30, readingTime: 3 })
    expect(snap.quizzes[0]).toMatchObject({
      id: 'b-quiz',
      description: 'Desc',
      questionIds: ['b-1', 'b-2'],
      source: SOURCE,
      origin: 'builtin',
      originFile: 'builtin:a/pack.json',
    })
  })

  it('lève si un pack livré est invalide', async () => {
    await put(builtinDir, 'b/pack.json', {
      source: SOURCE,
      questions: [question('x', { payload: { nope: 1 } })],
      quizzes: [],
    })
    await expect(readCatalog({ builtinDir })).rejects.toThrow(/pack\.json/)
  })

  it("écarte en entier un pack d'instance dont une question a un payload invalide", async () => {
    await put(extraDir, 'bad.json', {
      source: SOURCE,
      questions: [question('i-1'), question('i-2', { payload: { nope: 1 } })],
      quizzes: [],
    })
    await put(extraDir, 'good.json', { source: SOURCE, questions: [question('i-3')], quizzes: [] })
    const log = vi.fn()
    const snap = await readCatalog({ builtinDir, extraDir, log })
    expect(snap.questions.map((q) => q.id)).toEqual(['b-1', 'b-2', 'i-3'])
    expect(snap.rejectedFiles).toEqual(['instance:bad.json'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toContain('bad.json')
  })

  it("écarte un pack d'instance dont un id entre en conflit avec le catalogue livré", async () => {
    await put(extraDir, 'dup.json', { source: SOURCE, questions: [question('b-1')], quizzes: [] })
    const log = vi.fn()
    const snap = await readCatalog({ builtinDir, extraDir, log })
    expect(snap.rejectedFiles).toEqual(['instance:dup.json'])
    expect(snap.questions).toHaveLength(2)
    expect(log.mock.calls[0]![0]).toContain('b-1')
  })

  it('écarte un pack dont un quiz référence une question absente du pack', async () => {
    await put(extraDir, 'ref.json', {
      source: SOURCE,
      questions: [question('i-1')],
      quizzes: [quiz('i-quiz', ['b-1'])],
    })
    const log = vi.fn()
    const snap = await readCatalog({ builtinDir, extraDir, log })
    expect(snap.rejectedFiles).toEqual(['instance:ref.json'])
    expect(snap.quizzes.map((q) => q.id)).toEqual(['b-quiz'])
    expect(log).toHaveBeenCalledTimes(1)
  })

  it("thèmes d'instance : add, relabel, hide", async () => {
    await put(extraDir, 'themes.json', {
      add: [{ id: 'cuisine', label: 'Cuisine' }],
      relabel: { cinema: 'Ciné' },
      hide: ['sport'],
    })
    await put(extraDir, 'p.json', { source: SOURCE, questions: [question('i-1', { theme: 'cuisine' })], quizzes: [] })
    const snap = await readCatalog({ builtinDir, extraDir })
    expect(snap.rejectedFiles).toEqual([])
    const byId = Object.fromEntries(snap.themes.map((t) => [t.id, t]))
    expect(byId.cinema).toMatchObject({ label: 'Ciné', hidden: false, origin: 'builtin' })
    expect(byId.cuisine).toEqual({ id: 'cuisine', label: 'Cuisine', hidden: false, origin: 'instance' })
    expect(byId.sport).toMatchObject({ hidden: true })
    expect(snap.questions.map((q) => q.id)).toContain('i-1')
  })

  it("thèmes d'instance : relabel et hide d'un id inconnu sont journalisés et ignorés", async () => {
    await put(extraDir, 'themes.json', { relabel: { zzz: 'Z' }, hide: ['yyy'] })
    const log = vi.fn()
    const snap = await readCatalog({ builtinDir, extraDir, log })
    expect(snap.themes).toHaveLength(2)
    expect(log).toHaveBeenCalledTimes(2)
  })

  it("thèmes d'instance ajoutant un id existant : fichier ignoré, thèmes livrés intacts", async () => {
    await put(extraDir, 'themes.json', { add: [{ id: 'cinema', label: 'Autre' }], hide: ['sport'] })
    const log = vi.fn()
    const snap = await readCatalog({ builtinDir, extraDir, log })
    expect(snap.themes).toEqual([
      { id: 'cinema', label: 'Cinéma', hidden: false, origin: 'builtin' },
      { id: 'sport', label: 'Sport', hidden: false, origin: 'builtin' },
    ])
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('extraDir illisible (ENOTDIR) : journalisé, catalogue livré seul, sans lever', async () => {
    const notADir = join(root, 'fichier.txt')
    await put(root, 'fichier.txt', 'x')
    const log = vi.fn()
    const snap = await readCatalog({ builtinDir, extraDir: notADir, log })
    expect(snap.questions.every((q) => q.origin === 'builtin')).toBe(true)
    expect(snap.rejectedFiles).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('illisible'))
  })

  it('sans extraDir : seul le catalogue livré', async () => {
    const snap = await readCatalog({ builtinDir })
    expect(snap.questions.every((q) => q.origin === 'builtin')).toBe(true)
    expect(snap.rejectedFiles).toEqual([])
  })
})
