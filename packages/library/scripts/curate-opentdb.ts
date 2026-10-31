// Retouche des packs Open Trivia DB (https://opentdb.com, CC BY-SA 4.0) à partir des fichiers livrés.
//
// Usage (depuis la racine du dépôt) :
//   pnpm dlx tsx packages/library/scripts/curate-opentdb.ts
//
// La conversion d'origine (convert-opentdb.ts) n'est plus relancée : son cache est perdu et l'API
// tire ses questions au hasard. Ce script part donc des packs livrés dans catalog/opentdb/, retire
// les questions de `EXCLUDED`, applique les reclassements de `QUESTION_THEME` et remplace tous les
// quiz par ceux de `QUIZZES` (voir opentdb-plans.ts). Il est idempotent : le relancer sans changer
// les plans redonne les mêmes fichiers.
//
// Sortie : packages/library/catalog/opentdb/<thème>.json (questions d'un thème et quiz de ce thème),
// composes/<quiz>.json (un pack par quiz mêlant plusieurs thèmes, avec ses questions) et LICENSE.md.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readCatalog } from '../src/index.ts'
import { EXCLUDED, QUESTION_THEME, QUIZZES } from './opentdb-plans.ts'

const OUT_DIR = fileURLToPath(new URL('../catalog/opentdb', import.meta.url))
const CATALOG_DIR = fileURLToPath(new URL('../catalog', import.meta.url))
const PREFIX = 'otdb'
const MIXED_DIR = 'composes'

type Question = {
  id: string
  type: string
  prompt: string
  payload: unknown
  theme: string
  difficulty: string
  language: string
  audience: string
}
type Quiz = {
  id: string
  title: string
  description?: string
  theme: string
  difficulty: string
  language: string
  audience: string
  questionIds: string[]
}
type Pack = { source: unknown; questions: Question[]; quizzes: Quiz[] }

// Difficulté d'un quiz : la plus fréquente parmi ses questions (à égalité, dans cet ordre).
const DIFFICULTIES = ['moyen', 'facile', 'difficile']
function mostFrequent(questions: Question[]): string {
  const count = (d: string) => questions.filter((q) => q.difficulty === d).length
  return DIFFICULTIES.reduce((best, d) => (count(d) > count(best) ? d : best))
}

async function main() {
  // Lecture de tous les packs livrés (thèmes et quiz composés), dans un ordre stable.
  const files = (await readdir(OUT_DIR, { recursive: true }))
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.json'))
    .sort()
  let source: unknown
  const questions = new Map<string, Question>()
  for (const file of files) {
    const pack = JSON.parse(await readFile(`${OUT_DIR}/${file}`, 'utf8')) as Pack
    if (source === undefined) source = pack.source
    else if (JSON.stringify(pack.source) !== JSON.stringify(source)) throw new Error(`${file} : source différente`)
    for (const q of pack.questions) {
      if (questions.has(q.id)) throw new Error(`${q.id} : question en double (${file})`)
      questions.set(q.id, q)
    }
  }
  if (source === undefined) throw new Error(`aucun pack dans ${OUT_DIR}`)

  // Retraits motivés. Une question déjà retirée par un passage précédent est ignorée ; le compte des
  // identifiants sans question fait repérer une coquille (il vaut tout EXCLUDED dès le second passage).
  let unmatched = 0
  for (const [id, reason] of Object.entries(EXCLUDED)) {
    if (questions.delete(id)) console.log(`${id} retirée : ${reason}`)
    else unmatched++
  }
  console.log(`${unmatched} identifiants de EXCLUDED sans question dans le catalogue`)

  // Reclassements de thème.
  for (const [id, theme] of Object.entries(QUESTION_THEME)) {
    const q = questions.get(id)
    if (!q) {
      if (id in EXCLUDED) continue
      throw new Error(`reclassement de ${id} : question absente du catalogue`)
    }
    q.theme = theme
  }

  // Quiz : un quiz dont toutes les questions sont de son thème va dans le pack de ce thème ; un quiz
  // qui mêle plusieurs thèmes (mix, décennie) a son propre pack, qui reçoit aussi ses questions.
  const packs = new Map<string, { questions: Question[]; quizzes: Quiz[] }>()
  const packOf = (file: string) => {
    let pack = packs.get(file)
    if (!pack) {
      pack = { questions: [], quizzes: [] }
      packs.set(file, pack)
    }
    return pack
  }
  const slugs = new Set<string>()
  const used = new Set<string>()
  for (const plan of QUIZZES) {
    const where = `quiz « ${plan.slug} »`
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(plan.slug)) throw new Error(`${where} : slug invalide`)
    if (slugs.has(plan.slug)) throw new Error(`${where} : slug déjà utilisé`)
    slugs.add(plan.slug)
    if (plan.questions.length < 10 || plan.questions.length > 20) {
      throw new Error(`${where} : ${plan.questions.length} questions (10 à 20 attendues)`)
    }
    const qs = plan.questions.map((id) => {
      const q = questions.get(id)
      if (!q) throw new Error(`${where} : question ${id} absente du catalogue`)
      if (used.has(id)) throw new Error(`${where} : question ${id} déjà dans un autre quiz`)
      used.add(id)
      return q
    })
    const quiz: Quiz = {
      id: `${PREFIX}-quiz-${plan.slug}`,
      title: plan.title,
      ...(plan.description ? { description: plan.description } : {}),
      theme: plan.theme,
      difficulty: mostFrequent(qs),
      language: 'en',
      audience: 'tous',
      questionIds: plan.questions,
    }
    if (qs.every((q) => q.theme === plan.theme)) {
      packOf(`${plan.theme}.json`).quizzes.push(quiz)
    } else {
      const pack = packOf(`${MIXED_DIR}/${plan.slug}.json`)
      pack.quizzes.push(quiz)
      pack.questions.push(...qs)
      for (const q of qs) questions.delete(q.id)
    }
  }
  for (const q of questions.values()) packOf(`${q.theme}.json`).questions.push(q)

  // Réécriture : les packs vidés disparaissent, questions triées par identifiant comme à la conversion.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(`${OUT_DIR}/${MIXED_DIR}`, { recursive: true })
  for (const [file, content] of [...packs].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...content.questions].sort((a, b) => a.id.localeCompare(b.id))
    const pack = { source, questions: sorted, quizzes: content.quizzes }
    await writeFile(`${OUT_DIR}/${file}`, `${JSON.stringify(pack, null, 2)}\n`)
    console.log(`${file} : ${sorted.length} questions, ${content.quizzes.length} quiz`)
  }
  await writeFile(`${OUT_DIR}/LICENSE.md`, LICENSE_FILE)

  const snap = await readCatalog({ builtinDir: CATALOG_DIR })
  console.log(`catalogue : ${snap.questions.length} questions, ${snap.quizzes.length} quiz`)
}

const LICENSE_FILE = `# Données Open Trivia Database

Les questions de ce dossier (en anglais) proviennent d'Open Trivia Database (https://opentdb.com),
base de questions contributive créée et maintenue par PIXELTAIL GAMES LLC.

Licence : Creative Commons Attribution - Partage dans les mêmes conditions 4.0 International
(CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/

Le site indique (https://opentdb.com/api_config.php) : « All data provided by the API is
available under the Creative Commons Attribution-ShareAlike 4.0 International License. »

## Modifications

Les fichiers de ce dossier sont une adaptation des questions d'origine. Une première conversion,
faite par le script \`packages/library/scripts/convert-opentdb.ts\`, a mis les questions au format
des packs Pengou : classement par thème (d'après la catégorie d'origine), difficulté (easy, medium,
hard deviennent facile, moyen, difficile) et public, ordre des propositions déterminé par le script,
retrait des questions dont l'énoncé figurait déjà plus haut.

Le script \`packages/library/scripts/curate-opentdb.ts\` a ensuite retouché ces fichiers, d'après
la liste de \`packages/library/scripts/opentdb-plans.ts\` :

- retrait de questions dépassées, fausses, douteuses, ambiguës ou incompréhensibles, chacune avec
  son motif ;
- reclassement de questions dans un autre thème ;
- remplacement des quiz tirés automatiquement par des quiz composés à la main : quiz thématiques,
  quiz qui mêlent plusieurs thèmes et quiz par décennie, dont l'ordre des questions a été tiré au
  hasard une fois. Chaque quiz qui mêle plusieurs thèmes a son propre pack dans \`composes/\`.

Le texte des questions et des réponses n'est pas modifié, hormis la normalisation des espaces.

Cette adaptation est diffusée sous la même licence, CC BY-SA 4.0. Elle ne relève pas de la
licence Apache-2.0 du code de Pengou.

## Attribution

Attribution à reprendre : « Questions from the Open Trivia Database (https://opentdb.com), by
PIXELTAIL GAMES LLC and contributors, licensed under CC BY-SA 4.0 ».
`

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
