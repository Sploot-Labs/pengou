// Conversion d'OpenQuizzDB (https://www.openquizzdb.org, CC BY-SA 4.0) en packs du catalogue.
//
// Usage (depuis la racine du dépôt) :
//   pnpm dlx tsx packages/library/scripts/convert-openquizzdb.ts --cache <dossier>
//
// Le dossier de cache reçoit les données brutes téléchargées (liste des quiz et un JSON par quiz) ;
// il doit rester hors du dépôt. Un fichier déjà en cache n'est pas retéléchargé, ce qui rend la
// conversion reproductible : relancer le script sur le même cache produit les mêmes packs.
//
// Sortie : packages/library/catalog/openquizzdb/composes/<quiz>.json (un pack par quiz composé),
// quiz/<n°>.json (un pack par autre quiz source, dont la source cite le rédacteur et la page du quiz)
// et LICENSE.md (licence et attribution détaillée, quiz source par quiz source).

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readCatalog } from '../src/index.ts'
import { ADULT_QUESTIONS, EXCLUDED, QUESTION_THEME, QUIZZES } from './openquizzdb-plans.ts'

const SITE = 'https://www.openquizzdb.org'
const OUT_DIR = fileURLToPath(new URL('../catalog/openquizzdb', import.meta.url))
const CATALOG_DIR = fileURLToPath(new URL('../catalog', import.meta.url))
const LICENSE = 'CC BY-SA 4.0'
const quizPage = (id: number) => `${SITE}/download.php?id=${id}`
const PREFIX = 'oqdb'

// Catégories OpenQuizzDB (ancres de la page de liste) vers thèmes Pengou. Les catégories absentes
// sont écartées : ADULTES (contenu pour adultes), DEFI, MOTSCROISES, ORTHOQUIZZ et QUADRIQUIZZ (jeux
// de lettres et de calcul dont le format ne se prête pas à un QCM de quiz en direct).
const CATEGORY_THEME: Record<string, string> = {
  CINEMA: 'cinema',
  MUSIQUE: 'musique',
  SPORTS: 'sport',
  HISTOIRE: 'histoire',
  ARCHEOLOGIE: 'histoire',
  GEOGRAPHIE: 'geographie',
  MONDE: 'geographie',
  TOURISME: 'geographie',
  SCIENCES: 'sciences',
  INFORMATIQUE: 'sciences',
  INTERNET: 'sciences',
  WEB: 'sciences',
  LITTERATURE: 'litterature',
  BD: 'litterature',
  ARTS: 'art',
  NATURE: 'nature',
  ANIMAUX: 'nature',
  GASTRONOMIE: 'gastronomie',
  CULTURE: 'culture-generale',
  QUOTIDIEN: 'culture-generale',
  ALPHAQUIZZ: 'culture-generale',
  LOISIRS: 'culture-generale',
  TELEVISION: 'television',
  CELEBRITES: 'people',
}

// Exceptions par quiz source (identifiant OpenQuizzDB) au thème de sa catégorie.
const THEME_OVERRIDES: Record<number, string> = {
  297: 'jeux-video', // Nintendo
  147: 'jeux-video', // PlayStation 2
}

// Quiz source centrés sur l'alcool : public « adultes ». Tous les autres : « tous ».
const ADULT_QUIZZES = new Set<number>([
  141, // Rendez-vous au bar
  575, // Une larme de gin
  189, // Bières belges
  396, // Boissons hors des frontières
  418, // Vocabulaire du vin
  508, // Vins de France
  514, // Vins du monde
  516, // Ça se boit en Italie
  577, // Cocktails à base de gin
])

// Les fichiers OpenQuizzDB ne portent pas de niveau : toutes les questions sont classées « moyen ».
const DIFFICULTY = 'moyen'

// Questions isolées pour adultes (liste dans openquizzdb-plans.ts).
const ADULT_QUESTION_IDS = new Set(ADULT_QUESTIONS)

type ListingEntry = { id: number; category: string; title: string }
type RawQuestion = { id: number; question: string; propositions: string[]; réponse: string }
type RawQuiz = { rédacteur: string; thème: string; quizz: RawQuestion[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&Eacute;/g, 'É')
    .replace(/&amp;/g, '&')
}

// Liste des quiz téléchargeables : ancre de catégorie puis lignes `onclick="goq(<id>)"`.
function parseListing(html: string): ListingEntry[] {
  const re = /<div id="([A-Z]+)"><\/div>|onclick="goq\((\d+)\)">([^<]*)</g
  const out: ListingEntry[] = []
  let category = ''
  for (const m of html.matchAll(re)) {
    if (m[1]) category = m[1]
    else out.push({ id: Number(m[2]), category, title: decodeEntities(m[3].trim()) })
  }
  return out
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`)
  return res.text()
}

async function cached(file: string, load: () => Promise<string>): Promise<string> {
  if (existsSync(file)) return readFile(file, 'utf8')
  const text = await load()
  await writeFile(file, text)
  await sleep(500) // téléchargements espacés, par égard pour un projet bénévole
  return text
}

// La page de téléchargement d'un quiz (POST id=<n>) donne l'URL de son fichier JSON.
async function loadQuiz(cache: string, id: number): Promise<RawQuiz> {
  const text = await cached(`${cache}/${id}.json`, async () => {
    const page = await fetchText(`${SITE}/download.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `id=${id}`,
    })
    const url = page.match(/https:\/\/download\.openquizzdb\.org\/[^"]+\.json/)?.[0]
    if (!url) throw new Error(`quiz ${id} : lien JSON introuvable`)
    await sleep(500)
    return fetchText(url)
  })
  return JSON.parse(text.replace(/^﻿/, '')) as RawQuiz
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

// Clé de comparaison des énoncés : minuscules, sans diacritiques, espaces normalisés.
const normalizePrompt = (s: string) =>
  clean(
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  )

type Credit = { entry: ListingEntry; author: string; theme: string; count: number }

type OutQuestion = {
  id: string
  type: 'mcq'
  prompt: string
  payload: { options: { label: string; correct: boolean }[] }
  theme: string
  difficulty: string
  language: 'fr'
  audience: 'tous' | 'adultes'
}

// Une question source devient un QCM ; l'ordre des propositions est celui du fichier source.
function convertQuestion(entry: ListingEntry, theme: string, q: RawQuestion): OutQuestion | string {
  const id = `${PREFIX}-${String(entry.id).padStart(4, '0')}-${q.id}`
  if (id in EXCLUDED) return `exclue (${EXCLUDED[id]})`
  const prompt = clean(q.question)
  const labels = q.propositions.map(clean)
  const answer = clean(q.réponse)
  if (!prompt || prompt.length > 500) return 'énoncé vide ou trop long'
  if (labels.length < 2 || labels.length > 6) return 'nombre de propositions'
  if (labels.some((l) => !l || l.length > 200)) return 'proposition vide ou trop longue'
  if (new Set(labels).size !== labels.length) return 'propositions en double'
  if (labels.filter((l) => l === answer).length !== 1) return 'réponse absente des propositions'
  if (labels.some((l) => l.length > 25)) return 'proposition trop longue pour une tuile'
  return {
    id,
    type: 'mcq',
    prompt,
    payload: { options: labels.map((label) => ({ label, correct: label === answer })) },
    theme: QUESTION_THEME[id] ?? theme,
    difficulty: DIFFICULTY,
    language: 'fr',
    audience: ADULT_QUIZZES.has(entry.id) || ADULT_QUESTION_IDS.has(id) ? 'adultes' : 'tous',
  }
}

type Delivered = { prompt: string; options: { label: string; correct: boolean }[] }

// Questions déjà livrées (packs actuels de catalog/openquizzdb), à lire avant de régénérer le dossier.
async function readDelivered(dir: string): Promise<Map<string, Delivered>> {
  const out = new Map<string, Delivered>()
  if (!existsSync(dir)) return out
  for (const sub of await readdir(dir, { recursive: true })) {
    if (!sub.endsWith('.json')) continue
    const pack = JSON.parse(await readFile(`${dir}/${sub}`, 'utf8')) as { questions: OutQuestion[] }
    for (const q of pack.questions) out.set(q.id, { prompt: q.prompt, options: q.payload.options })
  }
  return out
}

async function main() {
  const i = process.argv.indexOf('--cache')
  const cache = i > 0 ? process.argv[i + 1] : undefined
  if (!cache) throw new Error('usage : convert-openquizzdb.ts --cache <dossier hors du dépôt>')
  await mkdir(cache, { recursive: true })
  const delivered = await readDelivered(OUT_DIR)

  const listing = parseListing(await cached(`${cache}/listing.html`, () => fetchText(`${SITE}/listing/`)))
  const selected = listing.filter((e) => e.category in CATEGORY_THEME)
  console.log(`${listing.length} quiz listés, ${selected.length} retenus`)

  // Énoncés en double d'un quiz source à l'autre : seule la première occurrence est gardée. Les
  // questions déjà livrées amorcent la table et gagnent donc le dédoublonnage, quel que soit le
  // numéro de leur quiz source ; pour les autres, l'ordre des numéros de quiz source décide.
  const seenPrompts = new Map<string, string>()
  for (const [id, d] of delivered) if (!(id in EXCLUDED)) seenPrompts.set(normalizePrompt(d.prompt), id)
  const questionsBySource = new Map<number, OutQuestion[]>()
  const authors = new Map<number, string>()
  const credits: Credit[] = []
  let duplicates = 0
  for (const entry of selected.sort((a, b) => a.id - b.id)) {
    const theme = THEME_OVERRIDES[entry.id] ?? CATEGORY_THEME[entry.category]
    const raw = await loadQuiz(cache, entry.id)
    const kept: OutQuestion[] = []
    for (const q of raw.quizz) {
      const out = convertQuestion(entry, theme, q)
      if (typeof out === 'string') {
        console.warn(`quiz ${entry.id} question ${q.id} écartée : ${out}`)
        continue
      }
      const key = normalizePrompt(out.prompt)
      const first = seenPrompts.get(key)
      if (first && first !== out.id) {
        console.warn(`${out.id} écartée : même énoncé que ${first}`)
        duplicates++
        continue
      }
      seenPrompts.set(key, out.id)
      kept.push(out)
    }
    if (kept.length === 0) continue
    const author = clean(raw.rédacteur)
    questionsBySource.set(entry.id, kept)
    authors.set(entry.id, author)
    credits.push({ entry, author, theme, count: kept.length })
  }
  console.log(`${duplicates} questions écartées comme doublons`)

  // Gel du livré : une question déjà livrée (hors EXCLUDED) doit exister en ligne à l'identique, et
  // son quiz source doit toujours figurer dans la liste.
  const converted = new Map<string, OutQuestion>()
  const sourceOf = new Map<string, number>()
  for (const [sourceId, qs] of questionsBySource) {
    for (const q of qs) {
      converted.set(q.id, q)
      sourceOf.set(q.id, sourceId)
    }
  }
  const listed = new Set(listing.map((e) => e.id))
  const missingSources = new Set<number>()
  const changed: string[] = []
  for (const [id, d] of delivered) {
    if (id in EXCLUDED) continue
    const sourceId = Number(id.split('-')[1])
    if (!listed.has(sourceId)) missingSources.add(sourceId)
    const q = converted.get(id)
    const same =
      q &&
      q.prompt === d.prompt &&
      q.payload.options.length === d.options.length &&
      q.payload.options.every((o, k) => o.label === d.options[k].label && o.correct === d.options[k].correct)
    if (!same) changed.push(id)
  }
  if (missingSources.size > 0) {
    throw new Error(`quiz source livrés absents de la liste en ligne : ${[...missingSources].join(', ')}`)
  }
  if (changed.length > 0) {
    throw new Error(`questions livrées manquantes ou modifiées en ligne : ${changed.join(', ')}`)
  }

  // Un pack par quiz composé (ses questions et le quiz) et un pack par quiz source restant : la source
  // d'un pack s'applique à toutes ses questions, ce qui permet de citer le rédacteur et la page du
  // quiz source sur chaque question.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(`${OUT_DIR}/composes`, { recursive: true })
  await mkdir(`${OUT_DIR}/quiz`, { recursive: true })
  const used = new Set<number>()
  const usedQuestions = new Set<string>()
  let total = 0
  for (const plan of QUIZZES) {
    if (!plan.sources === !plan.questions) {
      throw new Error(`quiz « ${plan.slug} » : exactement un de « sources » et « questions » est attendu`)
    }
    const titles: string[] = []
    const questions: OutQuestion[] = []
    const planAuthors = new Set<string>()
    for (const id of plan.sources ?? []) {
      const qs = questionsBySource.get(id)
      const entry = listing.find((e) => e.id === id)
      if (!qs || !entry) throw new Error(`quiz « ${plan.slug} » : quiz source ${id} indisponible`)
      if (used.has(id)) throw new Error(`quiz « ${plan.slug} » : quiz source ${id} déjà utilisé`)
      if (qs.some((q) => q.theme !== plan.theme || q.audience !== 'tous')) {
        throw new Error(`quiz « ${plan.slug} » : quiz source ${id} hors thème ou hors public « tous »`)
      }
      used.add(id)
      titles.push(`« ${entry.title} »`)
      questions.push(...qs)
      planAuthors.add(authors.get(id) ?? '')
    }
    for (const qid of plan.questions ?? []) {
      const q = converted.get(qid)
      const sourceId = sourceOf.get(qid)
      if (!q || sourceId === undefined) throw new Error(`quiz « ${plan.slug} » : question ${qid} indisponible`)
      questions.push(q)
      planAuthors.add(authors.get(sourceId) ?? '')
    }
    for (const q of questions) {
      if (usedQuestions.has(q.id)) throw new Error(`quiz « ${plan.slug} » : question ${q.id} déjà utilisée`)
      usedQuestions.add(q.id)
    }
    if (questions.length < 10 || questions.length > 20) {
      throw new Error(`quiz « ${plan.slug} » : ${questions.length} questions (10 à 20 attendues)`)
    }
    const list = `${titles.slice(0, -1).join(', ')} et ${titles.at(-1)}`
    const description =
      plan.description ??
      (plan.sources
        ? `D'après les quiz OpenQuizzDB ${list}.`
        : `D'après des questions OpenQuizzDB de ${[...planAuthors].join(', ')}.`)
    const quiz = {
      id: `${PREFIX}-quiz-${plan.slug}`,
      title: plan.title,
      description,
      theme: plan.theme,
      difficulty: DIFFICULTY,
      language: 'fr',
      audience: 'tous',
      questionIds: questions.map((q) => q.id),
    }
    const name = planAuthors.size === 1 ? `OpenQuizzDB, ${[...planAuthors][0]}` : 'OpenQuizzDB, plusieurs auteurs'
    const pack = { source: { name, license: LICENSE, url: SITE }, questions, quizzes: [quiz] }
    await writeFile(`${OUT_DIR}/composes/${plan.slug}.json`, `${JSON.stringify(pack, null, 2)}
`)
    total += questions.length
  }
  let rest = 0
  for (const [id, all] of questionsBySource) {
    const questions = all.filter((q) => !usedQuestions.has(q.id))
    if (questions.length === 0) continue
    rest++
    const source = { name: `OpenQuizzDB, ${authors.get(id)}`, license: LICENSE, url: quizPage(id) }
    const pack = { source, questions, quizzes: [] }
    await writeFile(`${OUT_DIR}/quiz/${String(id).padStart(4, '0')}.json`, `${JSON.stringify(pack, null, 2)}
`)
    total += questions.length
  }
  console.log(`${total} questions, ${QUIZZES.length} quiz composés, ${rest} packs de quiz source`)
  await writeFile(`${OUT_DIR}/LICENSE.md`, licenseFile(credits))

  // Vérification : le catalogue complet doit se lire sans erreur.
  const snap = await readCatalog({ builtinDir: CATALOG_DIR })
  console.log(`catalogue : ${snap.questions.length} questions, ${snap.quizzes.length} quiz`)
  console.log(`fichiers : ${(await readdir(OUT_DIR)).join(', ')}`)
}

function licenseFile(credits: Credit[]): string {
  const lines = credits.map(
    (c) =>
      `- n° ${c.entry.id}, « ${c.entry.title} », rédigé par ${c.author} ` +
      `(${c.count} questions, thème ${c.theme}) : ${quizPage(c.entry.id)}`,
  )
  return `# Données OpenQuizzDB

Les questions de ce dossier proviennent d'OpenQuizzDB, fournisseur de contenu libre
(${SITE}), projet coordonné par Philippe Bresoux.

Licence : Creative Commons Attribution - Partage dans les mêmes conditions 4.0 International
(CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/deed.fr

OpenQuizzDB indique sur sa page de projet (${SITE}/projet.html) : « Son contenu est proposé sous
licence Creative Commons BY-SA. Il peut être copié et réutilisé sous la même licence, sous réserve
d'en respecter les conditions. » Chaque page de téléchargement précise : « Ce quizz vous est
proposé sous licence Creative Commons CC BY-SA Attribution-ShareAlike 4.0 International. »

## Modifications

Les fichiers de ce dossier sont une adaptation des quiz d'origine, produite par le script
\`packages/library/scripts/convert-openquizzdb.ts\` : conversion au format des packs Pengou,
classement par thème, difficulté (« moyen » par défaut, la source n'en indiquant pas) et public,
regroupement en quiz de 10 à 20 questions (quiz source entiers ou questions choisies), retrait des
anecdotes, des liens Wikipédia, des questions dont l'énoncé figure déjà dans un quiz source de
numéro inférieur et des questions dépassées ou erronées (liste dans
\`scripts/openquizzdb-plans.ts\`), reclassement de certaines questions dans un autre thème. Le texte
des questions et des propositions n'est pas modifié, hormis la normalisation des espaces.

Cette adaptation est diffusée sous la même licence, CC BY-SA 4.0. Elle ne relève pas de la
licence Apache-2.0 du code de Pengou.

## Attribution

Attribution à reprendre : « Questions issues d'OpenQuizzDB (${SITE}), sous licence CC BY-SA 4.0 ».

Chaque pack porte sa propre source, reprise sur chaque question copiée dans Pengou : le dossier
\`quiz/\` contient un pack par quiz source, dont la source nomme le rédacteur (« OpenQuizzDB,
<rédacteur> ») et pointe vers la page du quiz sur OpenQuizzDB ; le dossier \`composes/\` contient un
pack par quiz composé, dont la source nomme le rédacteur commun ou « OpenQuizzDB, plusieurs
auteurs » et pointe vers le site. Le détail par quiz source figure ci-dessous.

Quiz source utilisés (numéro OpenQuizzDB, titre, rédacteur, lien) :

${lines.join('\n')}
`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
