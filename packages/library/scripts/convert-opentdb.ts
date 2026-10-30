// Conversion d'Open Trivia DB (https://opentdb.com, CC BY-SA 4.0) en packs du catalogue (anglais).
//
// Usage (depuis la racine du dépôt) :
//   pnpm dlx tsx packages/library/scripts/convert-opentdb.ts --cache <dossier>
//
// Le dossier de cache reçoit les réponses brutes de l'API (un fichier par catégorie) ; il doit
// rester hors du dépôt. Une catégorie déjà en cache n'est pas redemandée : l'API renvoyant un tirage
// aléatoire, c'est le cache qui rend la conversion reproductible. Les identifiants des questions
// sont dérivés d'une empreinte de leur texte, donc stables d'un tirage à l'autre.
//
// Sortie : packages/library/catalog/opentdb/<thème>.json et LICENSE.md.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readCatalog } from '../src/index.ts'

const API = 'https://opentdb.com'
const OUT_DIR = fileURLToPath(new URL('../catalog/opentdb', import.meta.url))
const CATALOG_DIR = fileURLToPath(new URL('../catalog', import.meta.url))
const SOURCE = { name: 'Open Trivia Database', license: 'CC BY-SA 4.0', url: API }
const PREFIX = 'otdb'
const PER_CATEGORY = 100

// Catégories Open Trivia DB retenues, vers thèmes Pengou. Les autres (télévision, comédies
// musicales, jeux de société, mythologie, politique, célébrités, véhicules, comics, gadgets,
// anime, dessins animés) n'ont pas de thème correspondant.
const CATEGORY_THEME: Record<number, string> = {
  9: 'culture-generale', // General Knowledge
  10: 'litterature', // Entertainment: Books
  11: 'cinema', // Entertainment: Film
  12: 'musique', // Entertainment: Music
  15: 'jeux-video', // Entertainment: Video Games
  17: 'sciences', // Science & Nature
  18: 'sciences', // Science: Computers
  19: 'sciences', // Science: Mathematics
  21: 'sport', // Sports
  22: 'geographie', // Geography
  23: 'histoire', // History
  25: 'art', // Art
  27: 'nature', // Animals
}

const DIFFICULTY: Record<string, 'facile' | 'moyen' | 'difficile'> = {
  easy: 'facile',
  medium: 'moyen',
  hard: 'difficile',
}

// Quiz composés automatiquement : les 15 premières questions (ordre des identifiants) d'une
// catégorie et d'une difficulté données.
const QUIZ_SIZE = 15
const QUIZZES = [
  { slug: 'video-games', title: 'Video games', category: 15, difficulty: 'easy' },
  { slug: 'general-knowledge', title: 'General knowledge', category: 9, difficulty: 'easy' },
  { slug: 'film', title: 'Film', category: 11, difficulty: 'easy' },
  { slug: 'geography', title: 'Geography', category: 22, difficulty: 'easy' },
  { slug: 'history', title: 'History', category: 23, difficulty: 'medium' },
  { slug: 'science-nature', title: 'Science and nature', category: 17, difficulty: 'easy' },
]

type RawQuestion = {
  type: 'multiple' | 'boolean'
  difficulty: string
  category: string
  question: string
  correct_answer: string
  incorrect_answers: string[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const b64 = (s: string) => Buffer.from(s, 'base64').toString('utf8')
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const hash = (s: string) => createHash('sha1').update(s).digest('hex')

async function getJson(url: string): Promise<{ response_code: number; results?: RawQuestion[]; token?: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`)
  return res.json() as Promise<{ response_code: number; results?: RawQuestion[]; token?: string }>
}

// L'API limite à 50 questions par appel et à un appel toutes les 5 secondes par adresse IP.
// Le jeton de session évite les doublons entre appels.
async function fetchCategory(token: string, category: number): Promise<RawQuestion[]> {
  const out: RawQuestion[] = []
  while (out.length < PER_CATEGORY) {
    await sleep(5500)
    const amount = Math.min(50, PER_CATEGORY - out.length)
    const data = await getJson(`${API}/api.php?amount=${amount}&category=${category}&encode=base64&token=${token}`)
    if (data.response_code !== 0 || !data.results) break // 1 : plus assez de questions, 4 : jeton épuisé
    out.push(
      ...data.results.map((r) => ({
        type: b64(r.type) as RawQuestion['type'],
        difficulty: b64(r.difficulty),
        category: b64(r.category),
        question: b64(r.question),
        correct_answer: b64(r.correct_answer),
        incorrect_answers: r.incorrect_answers.map(b64),
      })),
    )
  }
  return out
}

async function main() {
  const i = process.argv.indexOf('--cache')
  const cache = i > 0 ? process.argv[i + 1] : undefined
  if (!cache) throw new Error('usage : convert-opentdb.ts --cache <dossier hors du dépôt>')
  await mkdir(cache, { recursive: true })

  let token: string | undefined
  const raw = new Map<number, RawQuestion[]>()
  for (const category of Object.keys(CATEGORY_THEME).map(Number)) {
    const file = `${cache}/category-${category}.json`
    if (!existsSync(file)) {
      token ??= (await getJson(`${API}/api_token.php?command=request`)).token
      if (!token) throw new Error('jeton de session refusé')
      const questions = await fetchCategory(token, category)
      await writeFile(file, JSON.stringify(questions, null, 2))
      console.log(`catégorie ${category} : ${questions.length} questions téléchargées`)
    }
    raw.set(category, JSON.parse(await readFile(file, 'utf8')) as RawQuestion[])
  }

  type Out = { id: string; type: string; prompt: string; payload: unknown; theme: string; difficulty: string }
  const byTheme = new Map<string, Out[]>()
  const byCategory = new Map<number, (Out & { rawDifficulty: string })[]>()
  const seen = new Set<string>()
  for (const [category, questions] of raw) {
    const theme = CATEGORY_THEME[category]
    for (const q of questions) {
      const prompt = clean(q.question)
      const correct = clean(q.correct_answer)
      const wrong = q.incorrect_answers.map(clean)
      const id = `${PREFIX}-${hash(`${prompt}\n${correct}`).slice(0, 12)}`
      const difficulty = DIFFICULTY[q.difficulty]
      if (seen.has(id) || !difficulty || !prompt || prompt.length > 500) continue
      let out: Out
      if (q.type === 'boolean') {
        if (correct !== 'True' && correct !== 'False') continue
        out = { id, type: 'truefalse', prompt, payload: { correct: correct === 'True' }, theme, difficulty }
      } else {
        const labels = [correct, ...wrong]
        if (labels.some((l) => !l || l.length > 200) || new Set(labels).size !== labels.length) continue
        if (labels.length < 2 || labels.length > 6) continue
        // Ordre des propositions déterministe (tri par empreinte), la bonne réponse n'étant pas
        // toujours en tête.
        const options = labels
          .map((label) => ({ label, correct: label === correct }))
          .sort((a, b) => hash(`${id}${a.label}`).localeCompare(hash(`${id}${b.label}`)))
        out = { id, type: 'mcq', prompt, payload: { options }, theme, difficulty }
      }
      seen.add(id)
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), out])
      byCategory.set(category, [...(byCategory.get(category) ?? []), { ...out, rawDifficulty: q.difficulty }])
    }
  }

  const quizzesByTheme = new Map<string, unknown[]>()
  for (const plan of QUIZZES) {
    const theme = CATEGORY_THEME[plan.category]
    const pool = (byCategory.get(plan.category) ?? [])
      .filter((q) => q.rawDifficulty === plan.difficulty)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, QUIZ_SIZE)
    if (pool.length < 10) {
      console.warn(`quiz « ${plan.slug} » non composé : ${pool.length} questions disponibles`)
      continue
    }
    const quiz = {
      id: `${PREFIX}-quiz-${plan.slug}`,
      title: plan.title,
      description: 'Questions from the Open Trivia Database (opentdb.com), licensed under CC BY-SA 4.0.',
      theme,
      difficulty: DIFFICULTY[plan.difficulty],
      language: 'en',
      audience: 'tous',
      questionIds: pool.map((q) => q.id),
    }
    quizzesByTheme.set(theme, [...(quizzesByTheme.get(theme) ?? []), quiz])
  }

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  for (const [theme, questions] of [...byTheme].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...questions].sort((a, b) => a.id.localeCompare(b.id))
    const pack = {
      source: SOURCE,
      questions: sorted.map((q) => ({ ...q, language: 'en', audience: 'tous' })),
      quizzes: quizzesByTheme.get(theme) ?? [],
    }
    await writeFile(`${OUT_DIR}/${theme}.json`, `${JSON.stringify(pack, null, 2)}\n`)
    console.log(`${theme} : ${questions.length} questions, ${pack.quizzes.length} quiz`)
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

Les fichiers de ce dossier sont une adaptation des questions d'origine, produite par le script
\`packages/library/scripts/convert-opentdb.ts\` : conversion au format des packs Pengou, classement
par thème (d'après la catégorie d'origine), difficulté (easy, medium, hard deviennent facile, moyen,
difficile) et public, ordre des propositions déterminé par le script, regroupement en quiz de 15
questions. Le texte des questions et des réponses n'est pas modifié, hormis la normalisation des
espaces.

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
