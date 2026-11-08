import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateQuestionPayload } from '@splootlabs/quiz'
import {
  DEFAULT_READING_TIME,
  DEFAULT_TIME_LIMIT,
  builtinThemesSchema,
  instanceThemesSchema,
  packSchema,
  type CatalogSnapshot,
  type Origin,
  type SnapshotQuestion,
  type SnapshotQuiz,
  type SnapshotTheme,
  type Theme,
} from './schema.js'

// Valable depuis src (développement, tests) comme depuis dist (build).
export const BUILTIN_CATALOG_DIR: string = fileURLToPath(new URL('../catalog', import.meta.url))

const THEMES_FILE = 'themes.json'

export type ReadCatalogOptions = {
  builtinDir?: string
  extraDir?: string
  log?: (msg: string) => void
}

function reason(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)) {
    return err.issues
      .map(
        (i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join('.') || '(racine)'} : ${i.message}`,
      )
      .join(' ; ')
  }
  return err instanceof Error ? err.message : String(err)
}

// Liste récursive des fichiers `*.json` (hors themes.json), chemins relatifs avec `/`, triés.
async function listJsonFiles(dir: string, rel = ''): Promise<string[]> {
  const entries = await readdir(rel ? `${dir}/${rel}` : dir, { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listJsonFiles(dir, path)))
    else if (e.isFile() && e.name.endsWith('.json') && e.name !== THEMES_FILE) out.push(path)
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'))
}

type PackContent = { questions: SnapshotQuestion[]; quizzes: SnapshotQuiz[] }

type Registry = {
  themes: Map<string, SnapshotTheme>
  questionIds: Set<string>
  quizIds: Set<string>
}

// Valide un pack entier ; lève au premier défaut (message nommant l'élément fautif).
function parsePack(raw: unknown, origin: Origin, originFile: string, reg: Registry): PackContent {
  const parsed = packSchema.safeParse(raw)
  if (!parsed.success) throw new Error(reason(parsed.error))
  const { source } = parsed.data

  const localQuestionIds = new Set<string>()
  const questions: SnapshotQuestion[] = parsed.data.questions.map((q) => {
    const where = `question « ${q.id} »`
    if (reg.questionIds.has(q.id) || localQuestionIds.has(q.id)) throw new Error(`${where} : identifiant déjà utilisé`)
    localQuestionIds.add(q.id)
    if (!reg.themes.has(q.theme)) throw new Error(`${where} : thème inconnu « ${q.theme} »`)
    let payload: unknown
    try {
      payload = validateQuestionPayload(q.type, q.payload)
    } catch (err) {
      throw new Error(`${where} : payload invalide (${reason(err)})`)
    }
    return {
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      payload,
      theme: q.theme,
      difficulty: q.difficulty,
      language: q.language,
      audience: q.audience,
      timeLimit: q.timeLimit ?? DEFAULT_TIME_LIMIT,
      readingTime: q.readingTime ?? DEFAULT_READING_TIME,
      source,
      origin,
      originFile,
    }
  })

  const localQuizIds = new Set<string>()
  const quizzes: SnapshotQuiz[] = parsed.data.quizzes.map((z) => {
    const where = `quiz « ${z.id} »`
    if (reg.quizIds.has(z.id) || localQuizIds.has(z.id)) throw new Error(`${where} : identifiant déjà utilisé`)
    localQuizIds.add(z.id)
    if (!reg.themes.has(z.theme)) throw new Error(`${where} : thème inconnu « ${z.theme} »`)
    if (new Set(z.questionIds).size !== z.questionIds.length) throw new Error(`${where} : questionIds en double`)
    for (const qid of z.questionIds) {
      if (!localQuestionIds.has(qid)) throw new Error(`${where} : question « ${qid} » absente du pack`)
    }
    return {
      id: z.id,
      title: z.title,
      description: z.description ?? null,
      theme: z.theme,
      difficulty: z.difficulty,
      language: z.language,
      audience: z.audience,
      questionIds: z.questionIds,
      source,
      origin,
      originFile,
    }
  })

  return { questions, quizzes }
}

// Applique themes.json d'instance. Fichier invalide ou ajoutant un id existant : ignoré en entier.
async function applyInstanceThemes(file: string, reg: Registry, log: (msg: string) => void): Promise<void> {
  let raw: unknown
  try {
    raw = await readJson(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    log(`${THEMES_FILE} d'instance ignoré : ${reason(err)}`)
    return
  }
  const parsed = instanceThemesSchema.safeParse(raw)
  if (!parsed.success) {
    log(`${THEMES_FILE} d'instance ignoré : ${reason(parsed.error)}`)
    return
  }
  const { add = [], relabel = {}, hide = [] } = parsed.data

  const added = new Set<string>()
  for (const t of add) {
    if (reg.themes.has(t.id) || added.has(t.id)) {
      log(`${THEMES_FILE} d'instance ignoré : le thème « ${t.id} » existe déjà`)
      return
    }
    added.add(t.id)
  }

  for (const t of add) reg.themes.set(t.id, { id: t.id, label: t.label, hidden: false, origin: 'instance' })
  for (const [id, label] of Object.entries(relabel)) {
    const theme = reg.themes.get(id)
    if (!theme) log(`${THEMES_FILE} d'instance : relabel d'un thème inconnu « ${id} », ignoré`)
    else theme.label = label
  }
  for (const id of hide) {
    const theme = reg.themes.get(id)
    if (!theme) log(`${THEMES_FILE} d'instance : hide d'un thème inconnu « ${id} », ignoré`)
    else theme.hidden = true
  }
}

export async function readCatalog(opts: ReadCatalogOptions = {}): Promise<CatalogSnapshot> {
  const builtinDir = opts.builtinDir ?? BUILTIN_CATALOG_DIR
  const log = opts.log ?? ((msg: string) => console.warn(`[library] ${msg}`))

  const reg: Registry = { themes: new Map(), questionIds: new Set(), quizIds: new Set() }
  const questions: SnapshotQuestion[] = []
  const quizzes: SnapshotQuiz[] = []
  const rejectedFiles: string[] = []

  // 1. Thèmes livrés (une erreur lève).
  const themesFile = `${builtinDir}/${THEMES_FILE}`
  let builtinThemes: Theme[]
  try {
    builtinThemes = builtinThemesSchema.parse(await readJson(themesFile))
  } catch (err) {
    throw new Error(`builtin:${THEMES_FILE} : ${reason(err)}`)
  }
  for (const t of builtinThemes) {
    if (reg.themes.has(t.id)) throw new Error(`builtin:${THEMES_FILE} : thème « ${t.id} » en double`)
    reg.themes.set(t.id, { id: t.id, label: t.label, hidden: false, origin: 'builtin' })
  }

  // 2. Thèmes d'instance.
  if (opts.extraDir) await applyInstanceThemes(`${opts.extraDir}/${THEMES_FILE}`, reg, log)

  const commit = (content: PackContent) => {
    for (const q of content.questions) reg.questionIds.add(q.id)
    for (const z of content.quizzes) reg.quizIds.add(z.id)
    questions.push(...content.questions)
    quizzes.push(...content.quizzes)
  }

  // 3. Packs livrés : une erreur lève.
  for (const rel of await listJsonFiles(builtinDir)) {
    const originFile = `builtin:${rel}`
    try {
      commit(parsePack(await readJson(`${builtinDir}/${rel}`), 'builtin', originFile, reg))
    } catch (err) {
      throw new Error(`${originFile} : ${reason(err)}`)
    }
  }

  // 4. Packs d'instance, ordre alphabétique : une erreur écarte le fichier en entier.
  if (opts.extraDir) {
    let files: string[] = []
    try {
      files = await listJsonFiles(opts.extraDir)
    } catch (err) {
      // Dossier absent : normal. Illisible (EACCES, ENOTDIR...) : journalisé, catalogue livré seul.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log(`dossier d'instance illisible, ignoré : ${reason(err)}`)
      }
    }
    for (const rel of files) {
      const originFile = `instance:${rel}`
      try {
        commit(parsePack(await readJson(`${opts.extraDir}/${rel}`), 'instance', originFile, reg))
      } catch (err) {
        log(`${originFile} écarté : ${reason(err)}`)
        rejectedFiles.push(originFile)
      }
    }
  }

  return { themes: [...reg.themes.values()], questions, quizzes, rejectedFiles }
}
