import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG_DIR, readCatalog } from './index.js'

describe('catalogue livré', () => {
  it('le catalogue livré se lit sans erreur', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    expect(snap.quizzes.length).toBeGreaterThanOrEqual(1)
    expect(snap.rejectedFiles).toEqual([])
  })

  it('contient au moins 4800 questions et 120 quiz', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    expect(snap.questions.length).toBeGreaterThanOrEqual(4800)
    expect(snap.quizzes.length).toBeGreaterThanOrEqual(120)
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
        .replace(/[\u0300-\u036f]/g, '')
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

  it('chaque traduction garde le type, le nombre de propositions et la bonne réponse de son original', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const byId = new Map(snap.questions.map((q) => [q.id, q]))
    const options = (p: unknown) => (p as { options?: { correct: boolean }[] }).options
    for (const q of snap.questions) {
      const m = q.id.match(/^(.+)-(en|fr)$/)
      const original = m ? byId.get(m[1]) : undefined
      if (!original) continue
      expect(q.type, q.id).toBe(original.type)
      expect(q.language, q.id).not.toBe(original.language)
      const mine = options(q.payload)
      const theirs = options(original.payload)
      expect(mine?.length, q.id).toBe(theirs?.length)
      expect(mine?.findIndex((o) => o.correct), q.id).toBe(theirs?.findIndex((o) => o.correct))
      if (q.type === 'truefalse') {
        expect((q.payload as { correct: boolean }).correct, q.id).toBe((original.payload as { correct: boolean }).correct)
      }
    }
  })

  const TRANSLATED_PREFIXES = ['builtin:openquizzdb-en/', 'builtin:opentdb-fr/']
  const isTranslated = (originFile: string) => TRANSLATED_PREFIXES.some((p) => originFile.startsWith(p))

  it('les propositions tiennent dans une tuile', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const tooLong: string[] = []
    for (const q of snap.questions) {
      if (q.language !== 'fr' && !isTranslated(q.originFile)) continue
      const options = (q.payload as { options?: { label: string }[] }).options ?? []
      for (const o of options) if (o.label.length > 25) tooLong.push(`${q.id} : ${o.label}`)
    }
    expect(tooLong).toEqual([])
  })

  it('chaque quiz est dans la langue de ses questions', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const languages = new Map(snap.questions.map((q) => [q.id, q.language]))
    const mixed: string[] = []
    for (const quiz of snap.quizzes) {
      for (const id of quiz.questionIds) {
        if (languages.get(id) !== quiz.language) mixed.push(`${quiz.id} / ${id}`)
      }
    }
    expect(mixed).toEqual([])
  })

  it('propose au moins deux quiz en français par thème', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const few: string[] = []
    for (const theme of snap.themes.filter((t) => !t.hidden)) {
      const count = snap.quizzes.filter((z) => z.language === 'fr' && z.theme === theme.id).length
      if (count < 2) few.push(`${theme.id} : ${count}`)
    }
    expect(few).toEqual([])
  })

  it('pas de tiret cadratin ni demi-cadratin dans les textes traduits', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    const texts: [string, string][] = []
    for (const q of snap.questions.filter((x) => isTranslated(x.originFile))) {
      texts.push([q.id, q.prompt])
      const options = (q.payload as { options?: { label: string }[] }).options ?? []
      for (const o of options) texts.push([q.id, o.label])
    }
    for (const z of snap.quizzes.filter((x) => isTranslated(x.originFile))) {
      texts.push([z.id, z.title])
      if (z.description) texts.push([z.id, z.description])
    }
    expect(texts.filter(([, t]) => /[—–]/.test(t)).map(([id, t]) => `${id} : ${t}`)).toEqual([])
  })
})
