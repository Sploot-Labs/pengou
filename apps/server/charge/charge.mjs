// Générateur de charge Pengou : prépare un quiz par l'API REST, ouvre une ou plusieurs parties
// (sockets hôtes), répartit les joueurs entre processus enfants (joueurs.mjs), fait avancer les
// parties question par question puis agrège les mesures côté client dans un résumé JSON.
//
// Usage : pnpm --filter @splootlabs/server charge -- [--cible URL] [--joueurs N] [--parties N]
//   [--questions N] [--cadence N] [--processus N] [--libelle TEXTE] [--json CHEMIN] [--docker PROJET]
import { fork } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { io } from 'socket.io-client'
import { echantillonnerDocker, echantillonnerServeur } from './metriques.mjs'
import { estCibleLocale, resumer, verdict } from './stats.mjs'

const REVEAL_MAX_MS = 25_000
const ACK_HOTE_MAX_MS = 10_000
const PAUSE_ENTRE_QUESTIONS_MS = 1000
const DELAI_DEMARRAGE_MS = 2000
const PLAGE_REPONSE_MS = [500, 3000]
const PERIODE_METRIQUES_MS = 1000
const PERIODE_DOCKER_MS = 5000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function lireOptions() {
  // pnpm transmet le séparateur `--` tel quel : on l'ignore.
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const { values } = parseArgs({
    args,
    options: {
      cible: { type: 'string', default: 'http://localhost:3000' },
      joueurs: { type: 'string', default: '50' },
      parties: { type: 'string', default: '1' },
      questions: { type: 'string', default: '10' },
      cadence: { type: 'string', default: '25' },
      processus: { type: 'string' },
      libelle: { type: 'string' },
      json: { type: 'string' },
      docker: { type: 'string' },
    },
  })
  const entier = (nom, texte) => {
    const n = Number(texte)
    if (!Number.isInteger(n) || n < 1) {
      console.error(`Option --${nom} invalide : entier strictement positif attendu (reçu « ${texte} »).`)
      process.exit(1)
    }
    return n
  }
  const joueurs = entier('joueurs', values.joueurs)
  const parties = entier('parties', values.parties)
  const questions = entier('questions', values.questions)
  const cadence = Number(values.cadence)
  if (!Number.isFinite(cadence) || cadence <= 0) {
    console.error(`Option --cadence invalide : nombre strictement positif attendu (reçu « ${values.cadence} »).`)
    process.exit(1)
  }
  const total = joueurs * parties
  const processus = Math.min(
    total,
    values.processus === undefined ? Math.ceil(total / 100) : entier('processus', values.processus),
  )
  return {
    cible: values.cible.replace(/\/+$/, ''),
    joueurs,
    parties,
    questions,
    cadence,
    processus,
    libelle: values.libelle ?? `${parties}x${joueurs}`,
    json: values.json,
    docker: values.docker,
  }
}

const opts = lireOptions()

// Garde de cible : avant toute requête et avant tout processus enfant.
if (!estCibleLocale(opts.cible)) {
  console.error('Cible refusée : le test de charge ne vise que localhost.')
  process.exit(2)
}

const parametresPassage = () => ({
  joueurs: opts.joueurs,
  parties: opts.parties,
  questions: opts.questions,
  cadence: opts.cadence,
  processus: opts.processus,
  docker: opts.docker ?? null,
})

const horodatage = new Date().toISOString().replace(/[:.]/g, '-')

/** fetch vers la cible avec l'en-tête Origin (protection CSRF de Better Auth). Un 429 arrête tout. */
async function api(chemin, init) {
  const headers = { origin: opts.cible, ...(init?.headers ?? {}) }
  const res = await fetch(`${opts.cible}${chemin}`, { ...init, headers })
  const texte = await res.text()
  if (res.status === 429) {
    console.error(`Rate limit atteint sur ${chemin} : résultat non exploitable.`)
    process.exit(3)
  }
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${chemin} : ${res.status} ${texte}`)
  return { res, json: texte ? JSON.parse(texte) : null }
}

/** emit avec ack et délai maximal ; rejette si le serveur renvoie `{ error }`. */
function demander(socket, evenement, payload) {
  return new Promise((ok, ko) => {
    socket.timeout(ACK_HOTE_MAX_MS).emit(evenement, payload, (err, ack) => {
      if (err) return ko(new Error(`${evenement} : pas de réponse du serveur`))
      if (ack?.error) return ko(new Error(`${evenement} : ${ack.error}`))
      ok(ack)
    })
  })
}

function attendre(socket, evenement, delaiMs) {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => {
      socket.off(evenement, recu)
      ko(new Error(`${evenement} non reçu en ${delaiMs / 1000} s`))
    }, delaiMs)
    const recu = (data) => {
      clearTimeout(t)
      ok(data)
    }
    socket.once(evenement, recu)
  })
}

async function preparerQuiz() {
  const email = `charge-${horodatage}@pengou.test`
  const { res } = await api('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse-charge-123', name: 'Hôte charge' }),
  })
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  if (!cookie) throw new Error("aucun cookie de session reçu à l'inscription")

  const entetes = { 'content-type': 'application/json', cookie }
  const { json: quiz } = await api('/api/quizzes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ title: `Test de charge ${opts.libelle}` }),
  })
  for (let i = 1; i <= opts.questions; i++) {
    await api(`/api/quizzes/${quiz.id}/questions`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({
        type: 'mcq',
        prompt: `Question ${i}`,
        timeLimit: 20,
        readingTime: 0,
        payload: {
          options: [
            { label: 'A', correct: true },
            { label: 'B', correct: false },
            { label: 'C', correct: false },
            { label: 'D', correct: false },
          ],
        },
      }),
    })
  }
  return { cookie, quizId: quiz.id }
}

async function ouvrirPartie(cookie, quizId) {
  const socket = io(opts.cible, { extraHeaders: { cookie }, transports: ['websocket'] })
  await attendre(socket, 'connect', ACK_HOTE_MAX_MS)
  const { sessionId, pin } = await demander(socket, 'host:create', { quizId })
  await demander(socket, 'host:setAuto', { enabled: false })
  return { socket, sessionId, pin }
}

/** Joue une partie de bout en bout ; consigne dans `t0ParCle` l'instant d'envoi de chaque question. */
async function jouerPartie(partie, t0ParCle) {
  for (let index = 0; index < opts.questions; index++) {
    const reveal = attendre(partie.socket, 'question:reveal', REVEAL_MAX_MS)
    t0ParCle.set(`${partie.pin}:${index}`, Date.now())
    await demander(partie.socket, index === 0 ? 'host:start' : 'host:next', {})
    await reveal
    await sleep(PAUSE_ENTRE_QUESTIONS_MS)
  }
  const podium = attendre(partie.socket, 'podium', REVEAL_MAX_MS)
  await demander(partie.socket, 'host:next', {})
  await podium
}

/** Attend de chaque enfant un message du type donné ; échoue si un enfant meurt avant. */
function collecter(enfants, type) {
  return Promise.all(
    enfants.map(
      (enfant) =>
        new Promise((ok, ko) => {
          const surMessage = (msg) => {
            if (msg?.type !== type) return
            enfant.off('message', surMessage)
            enfant.off('exit', surSortie)
            ok(msg)
          }
          const surSortie = (code) => ko(new Error(`processus joueurs arrêté (code ${code}) avant « ${type} »`))
          enfant.on('message', surMessage)
          enfant.once('exit', surSortie)
        }),
    ),
  )
}

const additionner = (cible, source) => {
  for (const [cle, n] of Object.entries(source)) cible[cle] = (cible[cle] ?? 0) + n
  return cible
}

async function main() {
  const total = opts.joueurs * opts.parties
  console.log(
    `Test de charge ${opts.libelle} sur ${opts.cible} : ${opts.parties} partie(s) de ${opts.joueurs} joueurs, ` +
      `${opts.questions} question(s), ${opts.cadence} arrivées/s, ${opts.processus} processus.`,
  )

  const { cookie, quizId } = await preparerQuiz()
  const parties = []
  for (let i = 0; i < opts.parties; i++) parties.push(await ouvrirPartie(cookie, quizId))
  console.log(`Parties ouvertes : ${parties.map((p) => p.pin).join(', ')}.`)

  // Joueur global k : partie k mod parties, arrivée à k / cadence secondes, processus k mod processus.
  const lots = Array.from({ length: opts.processus }, () => [])
  for (let k = 0; k < total; k++) {
    const p = k % opts.parties
    const n = Math.floor(k / opts.parties) + 1
    lots[k % opts.processus].push({ pin: parties[p].pin, pseudo: `J${p + 1}-${n}`, decalageMs: (k * 1000) / opts.cadence })
  }

  const enfants = lots.map(() => fork(new URL('./joueurs.mjs', import.meta.url)))
  const arrivees = collecter(enfants, 'arrivees')
  // Échantillonnage serveur : lancé juste avant le début des arrivées, arrêté au podium.
  const echantillonServeur = echantillonnerServeur(opts.cible, PERIODE_METRIQUES_MS)
  const echantillonDocker = opts.docker ? echantillonnerDocker(opts.docker, PERIODE_DOCKER_MS) : null
  const debutEpochMs = Date.now() + DELAI_DEMARRAGE_MS
  enfants.forEach((enfant, i) => {
    enfant.send({ type: 'demarrer', cible: opts.cible, debutEpochMs, joueurs: lots[i], reponseMs: PLAGE_REPONSE_MS })
  })

  const rejointsParPin = {}
  const refus = {}
  for (const msg of await arrivees) {
    additionner(rejointsParPin, msg.rejointsParPin)
    additionner(refus, msg.refus)
  }
  const rejoints = Object.values(rejointsParPin).reduce((a, b) => a + b, 0)
  console.log(`Arrivées terminées : ${rejoints} joueurs rejoints sur ${total}.`)

  const t0ParCle = new Map()
  const resultats = collecter(enfants, 'resultat')
  await Promise.all(parties.map((partie) => jouerPartie(partie, t0ParCle)))
  const serveur = await echantillonServeur.arreter()
  const docker = echantillonDocker ? await echantillonDocker.arreter() : null
  for (const enfant of enfants) enfant.send({ type: 'terminer' })
  const recus = await resultats
  for (const partie of parties) partie.socket.close()

  const joinMs = recus.flatMap((r) => r.joinMs)
  const reponseMs = recus.flatMap((r) => r.reponseMs)
  const acceptesParPin = {}
  const erreurs = { ackTimeout: 0, reponseRefusee: 0, connexion: 0 }
  let deconnexions = 0
  let lagP99MaxMs = 0
  const derniereReception = new Map()
  let horlogeIncoherente = 0
  for (const r of recus) {
    additionner(acceptesParPin, r.acceptesParPin)
    additionner(erreurs, r.erreurs)
    deconnexions += r.deconnexions
    lagP99MaxMs = Math.max(lagP99MaxMs, r.lagP99Ms)
    for (const { pin, index, epochMs } of r.receptions) {
      const cle = `${pin}:${index}`
      const t0 = t0ParCle.get(cle)
      if (t0 === undefined) continue
      if (epochMs - t0 < 0) horlogeIncoherente += 1
      derniereReception.set(cle, Math.max(derniereReception.get(cle) ?? -Infinity, epochMs))
    }
  }
  const diffusionMs = [...derniereReception].map(([cle, epochMs]) => epochMs - t0ParCle.get(cle))
  // La première question part juste après les arrivées : c'est souvent la plus coûteuse.
  const premieres = [...derniereReception]
    .filter(([cle]) => cle.endsWith(':0'))
    .map(([cle, epochMs]) => epochMs - t0ParCle.get(cle))
  const diffusionPremiereMs = premieres.length > 0 ? Math.max(...premieres) : null

  const latences = {
    join: resumer(joinMs),
    reponse: resumer(reponseMs),
    diffusion: resumer(diffusionMs),
    diffusionPremiereMs,
  }
  const resume = {
    libelle: opts.libelle,
    horodatage,
    cible: opts.cible,
    parametres: parametresPassage(),
    parties: parties.map((p) => ({
      pin: p.pin,
      sessionId: p.sessionId,
      rejoints: rejointsParPin[p.pin] ?? 0,
      reponsesAcceptees: acceptesParPin[p.pin] ?? 0,
    })),
    joueurs: { tentes: total, rejoints, refus },
    latences,
    erreurs,
    deconnexions,
    horlogeIncoherente,
    generateur: { lagP99MaxMs: Math.round(lagP99MaxMs * 10) / 10 },
    serveur,
    ...(docker ? { docker } : {}),
  }
  const { criteres, verdict: issue } = verdict(resume)
  resume.criteres = criteres
  resume.verdict = issue

  const chemin = resolve(opts.json ?? `charge-${opts.libelle}-${horodatage}.json`)
  writeFileSync(chemin, `${JSON.stringify(resume, null, 2)}\n`)

  console.table({ join: latences.join, reponse: latences.reponse, diffusion: latences.diffusion })
  console.log(`Diffusion de la première question : ${latences.diffusionPremiereMs ?? 'n/d'} ms.`)
  const mesure = (x) => (Number.isFinite(x) ? x : 'n/d')
  console.table({
    'lag event loop p99 max (ms)': { valeur: mesure(serveur.lagP99MaxMs) },
    'lag event loop p95 des secondes (ms)': { valeur: mesure(serveur.lagP95Ms) },
    'secondes de lag au-dessus du seuil': { valeur: serveur.secondesLagAuDessus },
    'mémoire RSS max (Mo)': { valeur: mesure(serveur.rssMaxMo) },
    'heap max (Mo)': { valeur: mesure(serveur.heapMaxMo) },
    "CPU moyen (% d'un cœur)": { valeur: mesure(serveur.cpuMoyenPct) },
    "CPU max (% d'un cœur)": { valeur: mesure(serveur.cpuMaxPct) },
    'échantillons /metrics': { valeur: serveur.echantillons },
  })
  if (docker && Object.keys(docker).length > 0) console.table(docker)
  console.log(
    `Joueurs rejoints : ${rejoints}/${total}. Déconnexions : ${deconnexions}. ` +
      `Erreurs : ack hors délai ${erreurs.ackTimeout}, réponses refusées ${erreurs.reponseRefusee}, ` +
      `connexion ${erreurs.connexion}. Horloge incohérente : ${horlogeIncoherente}. ` +
      `Lag p99 du générateur : ${resume.generateur.lagP99MaxMs} ms.`,
  )
  if (Object.keys(refus).length > 0) console.log(`Refus au join : ${JSON.stringify(refus)}.`)
  console.log(`Critères : ${Object.entries(criteres).map(([nom, ok]) => `${nom} ${ok ? 'ok' : 'NON'}`).join(', ')}.`)
  console.log(`Verdict : ${issue}.`)
  console.log(`Résumé écrit dans ${chemin}.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(`Échec du test de charge : ${e.message}`)
  // Un passage interrompu est un résultat : on le consigne si un chemin JSON est demandé.
  if (opts.json) {
    const partiel = {
      libelle: opts.libelle,
      horodatage,
      cible: opts.cible,
      parametres: parametresPassage(),
      verdict: 'interrompu',
      erreur: e.message,
    }
    writeFileSync(resolve(opts.json), `${JSON.stringify(partiel, null, 2)}
`)
  }
  process.exit(1)
})
