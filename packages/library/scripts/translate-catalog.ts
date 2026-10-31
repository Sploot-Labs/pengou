// Traduction d'un dossier du catalogue à partir de tables de traduction versionnées.
//
// Usage (depuis la racine du dépôt) :
//   pnpm dlx tsx packages/library/scripts/translate-catalog.ts --from <dossier source> --to <langue>
//   (options : --catalog <dossier> et --translations <dossier> pour viser d'autres emplacements)
//
// Lit catalog/<from>/**.json, fusionne translations/<from>-<to>/*.json et écrit catalog/<from>-<to>/
// (même arborescence que la source, dossier vidé d'abord) avec son LICENSE.md. Échoue si une question
// n'a pas d'entrée dans les tables ou si une entrée ne correspond à aucune question de la source.
// Les packs sans aucune question traduite ne sont pas écrits.

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCatalog } from '../src/index.ts'
import { packSchema } from '../src/schema.ts'
import { type TranslationTable, mergeTables, translatePack } from '../src/translate.ts'

const CATALOG_DIR = fileURLToPath(new URL('../catalog', import.meta.url))
const TRANSLATIONS_DIR = fileURLToPath(new URL('../translations', import.meta.url))

const ORIGINS: Record<string, { name: string; url: string }> = {
  openquizzdb: { name: 'OpenQuizzDB', url: 'https://www.openquizzdb.org' },
  opentdb: { name: 'Open Trivia DB', url: 'https://opentdb.com' },
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function jsonFiles(dir: string): Promise<string[]> {
  const all = await readdir(dir, { recursive: true })
  return all.filter((f) => f.endsWith('.json')).map((f) => f.replaceAll(String.fromCharCode(92), '/')).sort()
}

async function main() {
  const from = arg('from')
  const to = arg('to')
  if (!from || !to) throw new Error('usage : translate-catalog.ts --from <dossier source> --to <langue>')
  const catalogDir = arg('catalog') ?? CATALOG_DIR
  const translationsDir = arg('translations') ?? TRANSLATIONS_DIR
  const srcDir = `${catalogDir}/${from}`
  const outDir = `${catalogDir}/${from}-${to}`
  const tablesDir = `${translationsDir}/${from}-${to}`
  if (!existsSync(srcDir)) throw new Error(`dossier source introuvable : ${srcDir}`)

  const tableFiles = existsSync(tablesDir) ? await jsonFiles(tablesDir) : []
  const tables: TranslationTable[] = []
  for (const f of tableFiles) {
    const t = JSON.parse(await readFile(`${tablesDir}/${f}`, 'utf8')) as Partial<TranslationTable>
    tables.push({ questions: t.questions ?? {}, quizzes: t.quizzes ?? {} })
  }
  const table = mergeTables(tables)

  const used = new Set<string>()
  const missing: string[] = []
  const skippedQuizzes: string[] = []
  const written: { file: string; pack: unknown }[] = []
  let questionCount = 0
  let quizCount = 0
  for (const file of await jsonFiles(srcDir)) {
    const pack = packSchema.parse(JSON.parse(await readFile(`${srcDir}/${file}`, 'utf8')))
    for (const q of pack.questions) used.add(q.id)
    for (const z of pack.quizzes) used.add(z.id)
    const result = translatePack(pack, table, to)
    missing.push(...result.missing)
    skippedQuizzes.push(...result.skippedQuizzes)
    if (!result.pack) continue
    written.push({ file, pack: result.pack })
    questionCount += result.pack.questions.length
    quizCount += result.pack.quizzes.length
  }

  const unmatched = [...Object.keys(table.questions), ...Object.keys(table.quizzes)].filter((k) => !used.has(k))
  if (missing.length > 0) {
    throw new Error(`${missing.length} entrées manquantes dans les tables (missing) : ${missing.join(', ')}`)
  }
  if (unmatched.length > 0) {
    throw new Error(`entrées sans question ni quiz correspondant : ${unmatched.join(', ')}`)
  }

  await rm(outDir, { recursive: true, force: true })
  for (const { file, pack } of written) {
    await mkdir(dirname(`${outDir}/${file}`), { recursive: true })
    await writeFile(`${outDir}/${file}`, `${JSON.stringify(pack, null, 2)}\n`)
  }
  await writeFile(`${outDir}/LICENSE.md`, licenseFile(from, to))

  for (const id of skippedQuizzes) console.log(`quiz non reproduit (question écartée) : ${id}`)
  console.log(`${questionCount} questions et ${quizCount} quiz traduits dans ${outDir}`)

  // Vérification : le catalogue complet doit se lire sans erreur.
  const snap = await readCatalog({ builtinDir: catalogDir })
  console.log(`catalogue : ${snap.questions.length} questions, ${snap.quizzes.length} quiz`)
}

function licenseFile(from: string, to: string): string {
  const origin = ORIGINS[from] ?? { name: from, url: '' }
  return `# Traduction de données ${origin.name}

Les questions de ce dossier sont une traduction (langue : ${to}) du contenu du dossier \`${from}\`,
issu de ${origin.name}${origin.url ? ` (${origin.url})` : ''}. Voir le fichier LICENSE du dossier \`${from}\` pour
l'attribution détaillée des quiz d'origine.

Licence : Creative Commons Attribution - Partage dans les mêmes conditions 4.0 International
(CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/deed.fr

## Modifications

Traduction par Sploot Labs, assistée par IA. Les énoncés, les propositions, les titres et les
descriptions des quiz sont traduits ; le type, le thème, la difficulté, le public, le nombre de
propositions et la bonne réponse de chaque question sont ceux de l'original. Certaines questions,
dont la traduction n'a pas de sens (jeux de mots, orthographe, etc.), sont écartées, ainsi que les
quiz qui les contiennent. Les identifiants sont ceux d'origine suivis de « -${to} ». Les tables de
traduction sont dans \`packages/library/translations/${from}-${to}/\`.

Cette adaptation est diffusée sous la même licence, CC BY-SA 4.0. Elle ne relève pas de la
licence Apache-2.0 du code de Pengou.
`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
