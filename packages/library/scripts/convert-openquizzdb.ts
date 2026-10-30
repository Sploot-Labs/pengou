// Conversion d'OpenQuizzDB (https://www.openquizzdb.org, CC BY-SA 4.0) en packs du catalogue.
//
// Usage (depuis la racine du dépôt) :
//   pnpm dlx tsx packages/library/scripts/convert-openquizzdb.ts --cache <dossier>
//
// Le dossier de cache reçoit les données brutes téléchargées (liste des quiz et un JSON par quiz) ;
// il doit rester hors du dépôt. Un fichier déjà en cache n'est pas retéléchargé, ce qui rend la
// conversion reproductible : relancer le script sur le même cache produit les mêmes packs.
//
// Sortie : packages/library/catalog/openquizzdb/<thème>.json (un pack par thème Pengou) et
// LICENSE.md (licence et attribution détaillée, quiz source par quiz source).

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readCatalog } from '../src/index.ts'

const SITE = 'https://www.openquizzdb.org'
const OUT_DIR = fileURLToPath(new URL('../catalog/openquizzdb', import.meta.url))
const CATALOG_DIR = fileURLToPath(new URL('../catalog', import.meta.url))
const SOURCE = { name: 'OpenQuizzDB', license: 'CC BY-SA 4.0', url: SITE }
const PREFIX = 'oqdb'

// Catégories OpenQuizzDB (ancres de la page de liste) vers thèmes Pengou. Les catégories absentes
// sont écartées : ADULTES (contenu pour adultes), CELEBRITES (people), TELEVISION (pas de thème
// correspondant), DEFI, MOTSCROISES, ORTHOQUIZZ et QUADRIQUIZZ (jeux de lettres et de calcul dont
// le format ne se prête pas à un QCM de quiz en direct).
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
}

// Exceptions par quiz source (identifiant OpenQuizzDB) au thème de sa catégorie.
const THEME_OVERRIDES: Record<number, string> = {
  297: 'jeux-video', // Nintendo
  147: 'jeux-video', // PlayStation 2
}

// Quiz source centrés sur l'alcool : public « adultes ». Tous les autres : « tous ».
const ADULT_QUIZZES = new Set<number>([
  141, // Rendez-vous au bar
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

// Quiz Pengou composés à partir de quiz source (4 questions chacun), 10 à 20 questions par quiz.
type QuizPlan = { slug: string; title: string; theme: string; sources: number[] }
const QUIZZES: QuizPlan[] = [
  { slug: 'cinema-francais', title: 'Stars du cinéma français', theme: 'cinema', sources: [35, 47, 107, 65] },
  { slug: 'sagas-sf', title: 'Sagas de science-fiction', theme: 'cinema', sources: [37, 408, 384, 389] },
  { slug: 'chanson-francaise', title: 'Chanson française', theme: 'musique', sources: [77, 29, 83, 417] },
  { slug: 'new-wave', title: 'Les années new wave', theme: 'musique', sources: [313, 307, 429, 562] },
  { slug: 'football', title: 'Football', theme: 'sport', sources: [87, 99, 502, 400] },
  { slug: 'olympisme-tennis', title: 'Olympisme et tennis', theme: 'sport', sources: [261, 437, 247, 253] },
  {
    slug: 'civilisations-anciennes',
    title: 'Civilisations anciennes',
    theme: 'histoire',
    sources: [453, 199, 550, 127, 513],
  },
  { slug: 'guerres-et-dates', title: 'Batailles et grandes dates', theme: 'histoire', sources: [422, 394, 420, 518] },
  { slug: 'tour-europe', title: "Tour d'Europe", theme: 'geographie', sources: [257, 359, 454, 353, 365] },
  { slug: 'villes-iles-lacs', title: 'Villes, îles et lacs', theme: 'geographie', sources: [360, 542, 428, 91] },
  { slug: 'chimie-corps', title: 'Chimie, corps humain et mesures', theme: 'sciences', sources: [380, 375, 557, 419] },
  { slug: 'planetes-inventeurs', title: 'Planètes et inventeurs', theme: 'sciences', sources: [57, 63, 139, 503] },
  { slug: 'romans-populaires', title: 'Romans populaires', theme: 'litterature', sources: [181, 312, 85, 397] },
  {
    slug: 'bande-dessinee',
    title: 'Bande dessinée',
    theme: 'litterature',
    sources: [464, 469, 459, 105, 567],
  },
  { slug: 'art-musees', title: 'Art et musées', theme: 'art', sources: [405, 377, 466, 145, 399] },
  { slug: 'animaux-du-monde', title: 'Animaux du monde', theme: 'nature', sources: [545, 383, 207, 491] },
  { slug: 'arbres-fleurs-volcans', title: 'Arbres, fleurs et volcans', theme: 'nature', sources: [213, 370, 563, 45] },
  { slug: 'fromages-desserts', title: 'Fromages et desserts', theme: 'gastronomie', sources: [205, 201, 211, 235] },
  { slug: 'cuisines-ailleurs', title: "Cuisines d'ailleurs", theme: 'gastronomie', sources: [519, 523, 445, 390] },
  {
    slug: 'alphaquizz',
    title: 'Culture générale de C à G',
    theme: 'culture-generale',
    sources: [28, 40, 52, 64, 76],
  },
  {
    slug: 'maison-quotidien',
    title: 'La maison et le quotidien',
    theme: 'culture-generale',
    sources: [604, 608, 467, 472],
  },
]

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
  const prompt = clean(q.question)
  const labels = q.propositions.map(clean)
  const answer = clean(q.réponse)
  if (!prompt || prompt.length > 500) return 'énoncé vide ou trop long'
  if (labels.length < 2 || labels.length > 6) return 'nombre de propositions'
  if (labels.some((l) => !l || l.length > 200)) return 'proposition vide ou trop longue'
  if (new Set(labels).size !== labels.length) return 'propositions en double'
  if (labels.filter((l) => l === answer).length !== 1) return 'réponse absente des propositions'
  return {
    id: `${PREFIX}-${String(entry.id).padStart(4, '0')}-${q.id}`,
    type: 'mcq',
    prompt,
    payload: { options: labels.map((label) => ({ label, correct: label === answer })) },
    theme,
    difficulty: DIFFICULTY,
    language: 'fr',
    audience: ADULT_QUIZZES.has(entry.id) ? 'adultes' : 'tous',
  }
}

async function main() {
  const i = process.argv.indexOf('--cache')
  const cache = i > 0 ? process.argv[i + 1] : undefined
  if (!cache) throw new Error('usage : convert-openquizzdb.ts --cache <dossier hors du dépôt>')
  await mkdir(cache, { recursive: true })

  const listing = parseListing(await cached(`${cache}/listing.html`, () => fetchText(`${SITE}/listing/`)))
  const selected = listing.filter((e) => e.category in CATEGORY_THEME)
  console.log(`${listing.length} quiz listés, ${selected.length} retenus`)

  const byTheme = new Map<string, OutQuestion[]>()
  const questionsBySource = new Map<number, OutQuestion[]>()
  const credits: { entry: ListingEntry; author: string; theme: string; count: number }[] = []
  for (const entry of selected.sort((a, b) => a.id - b.id)) {
    const theme = THEME_OVERRIDES[entry.id] ?? CATEGORY_THEME[entry.category]
    const raw = await loadQuiz(cache, entry.id)
    const kept: OutQuestion[] = []
    for (const q of raw.quizz) {
      const out = convertQuestion(entry, theme, q)
      if (typeof out === 'string') console.warn(`quiz ${entry.id} question ${q.id} écartée : ${out}`)
      else kept.push(out)
    }
    if (kept.length === 0) continue
    questionsBySource.set(entry.id, kept)
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), ...kept])
    credits.push({ entry, author: clean(raw.rédacteur), theme, count: kept.length })
  }

  const quizzesByTheme = new Map<string, unknown[]>()
  for (const plan of QUIZZES) {
    const titles: string[] = []
    const questionIds: string[] = []
    for (const id of plan.sources) {
      const qs = questionsBySource.get(id)
      const entry = listing.find((e) => e.id === id)
      if (!qs || !entry) throw new Error(`quiz « ${plan.slug} » : quiz source ${id} indisponible`)
      if (qs.some((q) => q.theme !== plan.theme || q.audience !== 'tous')) {
        throw new Error(`quiz « ${plan.slug} » : quiz source ${id} hors thème ou hors public « tous »`)
      }
      titles.push(`« ${entry.title} »`)
      questionIds.push(...qs.map((q) => q.id))
    }
    if (questionIds.length < 10 || questionIds.length > 20) {
      throw new Error(`quiz « ${plan.slug} » : ${questionIds.length} questions (10 à 20 attendues)`)
    }
    const list = `${titles.slice(0, -1).join(', ')} et ${titles.at(-1)}`
    const quiz = {
      id: `${PREFIX}-quiz-${plan.slug}`,
      title: plan.title,
      description: `D'après les quiz OpenQuizzDB ${list}.`,
      theme: plan.theme,
      difficulty: DIFFICULTY,
      language: 'fr',
      audience: 'tous',
      questionIds,
    }
    quizzesByTheme.set(plan.theme, [...(quizzesByTheme.get(plan.theme) ?? []), quiz])
  }

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  for (const [theme, questions] of [...byTheme].sort(([a], [b]) => a.localeCompare(b))) {
    const pack = { source: SOURCE, questions, quizzes: quizzesByTheme.get(theme) ?? [] }
    await writeFile(`${OUT_DIR}/${theme}.json`, `${JSON.stringify(pack, null, 2)}\n`)
    console.log(`${theme} : ${questions.length} questions, ${pack.quizzes.length} quiz`)
  }
  await writeFile(`${OUT_DIR}/LICENSE.md`, licenseFile(credits))

  // Vérification : le catalogue complet doit se lire sans erreur.
  const snap = await readCatalog({ builtinDir: CATALOG_DIR })
  console.log(`catalogue : ${snap.questions.length} questions, ${snap.quizzes.length} quiz`)
  console.log(`fichiers : ${(await readdir(OUT_DIR)).join(', ')}`)
}

function licenseFile(credits: { entry: ListingEntry; author: string; theme: string; count: number }[]): string {
  const lines = credits.map(
    (c) =>
      `- n° ${c.entry.id}, « ${c.entry.title} », rédigé par ${c.author} ` +
      `(${c.count} questions, thème ${c.theme}) : ${SITE}/download.php?id=${c.entry.id}`,
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
regroupement en quiz de 10 à 20 questions, retrait des anecdotes et des liens Wikipédia. Le texte
des questions et des propositions n'est pas modifié, hormis la normalisation des espaces.

Cette adaptation est diffusée sous la même licence, CC BY-SA 4.0. Elle ne relève pas de la
licence Apache-2.0 du code de Pengou.

## Attribution

Attribution à reprendre : « Questions issues d'OpenQuizzDB (${SITE}), sous licence CC BY-SA 4.0 ».

Quiz source utilisés (numéro OpenQuizzDB, titre, rédacteur, lien) :

${lines.join('\n')}
`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
