import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG_DIR, readCatalog } from './index.js'

describe('catalogue livré', () => {
  it('le catalogue livré se lit sans erreur', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    expect(snap.quizzes.length).toBeGreaterThanOrEqual(1)
    expect(snap.rejectedFiles).toEqual([])
  })

  it('contient au moins 300 questions et 10 quiz', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    expect(snap.questions.length).toBeGreaterThanOrEqual(300)
    expect(snap.quizzes.length).toBeGreaterThanOrEqual(10)
  })

  it('chaque quiz compte de 10 à 20 questions', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    for (const quiz of snap.quizzes) {
      expect(quiz.questionIds.length, quiz.id).toBeGreaterThanOrEqual(10)
      expect(quiz.questionIds.length, quiz.id).toBeLessThanOrEqual(20)
    }
  })

  it('chaque thème livré est utilisé par au moins une question', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const used = new Set(snap.questions.map((q) => q.theme))
    const unused = snap.themes.filter((t) => !used.has(t.id)).map((t) => t.id)
    expect(unused).toEqual([])
  })

  it('propose des questions en français', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    expect(snap.questions.some((q) => q.language === 'fr')).toBe(true)
  })

  it('aucune question en double (énoncé normalisé) dans un quiz ni dans une même langue', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
    const prompts = new Map(snap.questions.map((q) => [q.id, norm(q.prompt)]))
    for (const quiz of snap.quizzes) {
      const list = quiz.questionIds.map((id) => prompts.get(id))
      expect(new Set(list).size, quiz.id).toBe(list.length)
    }
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const q of snap.questions) {
      const key = `${q.language}|${norm(q.prompt)}`
      const first = seen.get(key)
      if (first) duplicates.push(`${first} / ${q.id}`)
      else seen.set(key, q.id)
    }
    expect(duplicates).toEqual([])
  })

  it('chaque question OpenQuizzDB cite son rédacteur', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const oqdb = snap.questions.filter((q) => q.id.startsWith('oqdb-'))
    expect(oqdb.length).toBeGreaterThan(0)
    for (const q of oqdb) expect(q.source.name, q.id).toMatch(/^OpenQuizzDB, \S/)
  })

  it('chaque dossier de source contient un fichier LICENSE*', async () => {
    const entries = await readdir(BUILTIN_CATALOG_DIR, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    expect(dirs.length).toBeGreaterThanOrEqual(1)
    for (const dir of dirs) {
      const files = await readdir(`${BUILTIN_CATALOG_DIR}/${dir}`)
      expect(
        files.some((f) => f.startsWith('LICENSE')),
        `${dir} sans fichier LICENSE*`,
      ).toBe(true)
    }
  })
})
