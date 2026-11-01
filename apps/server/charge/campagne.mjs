// Campagne de charge lancée à la main : pour chaque passage d'un scénario, remet la pile
// `pengou-charge` à zéro, attend /health, lance charge.mjs, vérifie la cohérence de la base, puis
// ajoute une ligne par passage à docs/charge/historique.jsonl et compare à la campagne précédente.
//
// Usage : pnpm --filter @splootlabs/server charge:campagne -- [--scenario rapide|complet]
//   [--pause SECONDES] [--sans-build]
// Codes de sortie : 0 tout réussi sans régression, 1 passage non réussi ou régression, 2 pile
// impossible à démarrer.
import { execFile, fork, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ajouterHistorique, comparer, ligneHistorique, lireHistorique } from './historique.mjs'
import { SCENARIOS } from './scenarios.mjs'

const RACINE = fileURLToPath(new URL('../../../', import.meta.url))
const CIBLE = 'http://localhost:3000'
const PROJET = 'pengou-charge'
const COMPOSE = ['compose', '-p', PROJET, '-f', join(RACINE, 'docker-compose.charge.yml')]
const HISTORIQUE = join(RACINE, 'docs', 'charge', 'historique.jsonl')
const QUESTIONS = 10
const SANTE_MAX_MS = 120_000
const COHERENCE_MAX_MS = 60_000
const COHERENCE_PERIODE_MS = 5000
const GO = 1024 ** 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const auDixieme = (x) => Math.round(x * 10) / 10

function lireOptions() {
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const { values } = parseArgs({
    args,
    options: {
      scenario: { type: 'string', default: 'rapide' },
      pause: { type: 'string', default: '30' },
      'sans-build': { type: 'boolean', default: false },
    },
  })
  if (!SCENARIOS[values.scenario]) {
    console.error(`Scénario inconnu « ${values.scenario} » : ${Object.keys(SCENARIOS).join(' ou ')} attendu.`)
    process.exit(1)
  }
  const pause = Number(values.pause)
  if (!Number.isFinite(pause) || pause < 0) {
    console.error(`Option --pause invalide : nombre de secondes positif attendu (reçu « ${values.pause} »).`)
    process.exit(1)
  }
  return { scenario: values.scenario, pauseMs: pause * 1000, build: !values['sans-build'] }
}

/** Commande capturée ; ne rejette jamais, renvoie le code et les sorties. */
function capturer(commande, args) {
  return new Promise((ok) => {
    execFile(commande, args, { cwd: RACINE, maxBuffer: 16 * 1024 * 1024 }, (err, sortie, erreurs) => {
      ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, sortie, erreurs })
    })
  })
}

/** Commande dont la sortie s'affiche telle quelle ; renvoie son code. */
function afficher(commande, args) {
  return new Promise((ok) => {
    const enfant = spawn(commande, args, { cwd: RACINE, stdio: 'inherit' })
    enfant.on('error', () => ok(1))
    enfant.on('exit', (code) => ok(code ?? 1))
  })
}

async function compose(...args) {
  const code = await afficher('docker', [...COMPOSE, ...args])
  if (code !== 0) {
    console.error(`docker compose ${args.join(' ')} a échoué (code ${code}) : pile ${PROJET} non démarrée.`)
    process.exit(2)
  }
}

async function contexteCampagne(scenario) {
  const commit = (await capturer('git', ['rev-parse', '--short', 'HEAD'])).sortie.trim() || 'inconnu'
  const modifie = (await capturer('git', ['status', '--porcelain'])).sortie.trim() !== ''
  const [ncpu, memoire] = (await capturer('docker', ['info', '--format', '{{.NCPU}} {{.MemTotal}}'])).sortie.trim().split(' ')
  const horodatage = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
  return {
    campagne: `${horodatage}-${commit}`,
    scenario,
    commit,
    modifie,
    machine: {
      // Le modèle renvoyé par Node peut finir par des espaces : sans trim, aucune comparaison ne tient.
      cpu: cpus()[0]?.model.trim() ?? 'inconnu',
      coeurs: cpus().length,
      memGo: auDixieme(totalmem() / GO),
      dockerCpus: Number(ncpu) || null,
      dockerMemGo: Number(memoire) ? auDixieme(Number(memoire) / GO) : null,
    },
  }
}

async function attendreSante() {
  const fin = Date.now() + SANTE_MAX_MS
  while (Date.now() < fin) {
    try {
      const res = await fetch(`${CIBLE}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {
      // Serveur pas encore prêt.
    }
    await sleep(1000)
  }
  console.error(`/health n'a pas répondu en ${SANTE_MAX_MS / 1000} s : pile ${PROJET} non démarrée.`)
  process.exit(2)
}

/** Lance charge.mjs pour un passage et renvoie son résumé, ou un résumé interrompu s'il n'en a pas écrit. */
function lancerCharge(passage, libelle, cheminJson) {
  const args = [
    '--cible', CIBLE,
    '--joueurs', String(passage.joueurs),
    '--parties', String(passage.parties),
    '--cadence', String(passage.cadence),
    '--questions', String(QUESTIONS),
    '--libelle', libelle,
    '--json', cheminJson,
    '--docker', PROJET,
  ]
  return new Promise((ok) => {
    const enfant = fork(fileURLToPath(new URL('./charge.mjs', import.meta.url)), args, { stdio: 'inherit' })
    enfant.on('exit', (code) => {
      if (existsSync(cheminJson)) return ok(JSON.parse(readFileSync(cheminJson, 'utf8')))
      ok({
        libelle,
        parametres: { joueurs: passage.joueurs, parties: passage.parties, questions: QUESTIONS, cadence: passage.cadence },
        verdict: 'interrompu',
        erreur: `charge.mjs arrêté sans résumé (code ${code})`,
      })
    })
  })
}

async function comptesBase(sessionId) {
  const requete =
    `select (select count(*) from session_player where session_id = '${sessionId}'), ` +
    `(select count(*) from answer_record where session_id = '${sessionId}')`
  const { code, sortie } = await capturer('docker', [...COMPOSE, 'exec', '-T', 'db', 'psql', '-U', 'pengou', '-d', 'pengou', '-tAc', requete])
  if (code !== 0) return null
  const [joueurs, reponses] = sortie.trim().split('|').map(Number)
  return { joueurs, reponses }
}

/**
 * Vrai si, pour chaque partie, la base contient autant de joueurs que de rejoints et autant de
 * réponses que d'accusés acceptés. Les dernières écritures peuvent arriver après la fin du
 * générateur : on relit pendant COHERENCE_MAX_MS avant de conclure.
 */
async function verifierCoherence(resume) {
  const fin = Date.now() + COHERENCE_MAX_MS
  for (;;) {
    let concorde = true
    for (const partie of resume.parties) {
      const comptes = await comptesBase(partie.sessionId)
      if (!comptes || comptes.joueurs !== partie.rejoints || comptes.reponses !== partie.reponsesAcceptees) concorde = false
    }
    if (concorde) return true
    if (Date.now() >= fin) return false
    await sleep(COHERENCE_PERIODE_MS)
  }
}

const valeur = (x, unite = ' ms') => (x === null || x === undefined ? 'n/d' : `${x}${unite}`)

function phrasePassage(l) {
  if (l.verdict === 'interrompu') return `${l.libelle} : interrompu.`
  const echecs = l.criteresEchoues.length > 0 ? ` (critères en échec : ${l.criteresEchoues.join(', ')})` : ''
  const coherence = l.coherence === true ? 'base cohérente' : 'base incohérente'
  return (
    `${l.libelle} : ${l.verdict}${echecs}. Réponse p95 ${valeur(l.reponseP95)}, diffusion p95 ` +
    `${valeur(l.diffusionP95)} (première question ${valeur(l.diffusionPremiereMs)}), lag p95 ` +
    `${valeur(l.lagP95Ms)} et max ${valeur(l.lagP99MaxMs)}, ${valeur(l.secondesLagAuDessus, '')} s ` +
    `au-dessus du seuil, CPU app ${valeur(l.cpuAppMaxPct, ' %')}, RSS ${valeur(l.rssMaxMo, ' Mo')}, ${coherence}.`
  )
}

function phraseComparaison({ cle, reference, regressions }) {
  if (!reference) return `${cle} : aucune référence.`
  if (regressions.length === 0) return `${cle} : aucune régression par rapport à ${reference}.`
  return `${cle} : régression par rapport à ${reference} (${regressions.join(', ')}).`
}

function ecrireResume(dossier, contexte, lignes, comparaison) {
  const { machine } = contexte
  const texte = [
    `# Campagne de charge ${contexte.campagne}`,
    '',
    `Scénario ${contexte.scenario}, commit ${contexte.commit}${contexte.modifie ? ' avec des modifications non commitées' : ''}. ` +
      `Machine : ${machine.cpu}, ${machine.coeurs} threads, ${machine.memGo} Go ; Docker ${valeur(machine.dockerCpus, '')} CPU, ` +
      `${valeur(machine.dockerMemGo, ' Go')}.`,
    '',
    '## Passages',
    '',
    ...lignes.map(phrasePassage),
    '',
    '## Comparaison',
    '',
    ...comparaison.map(phraseComparaison),
    '',
  ].join('\n')
  writeFileSync(join(dossier, 'resume.md'), texte)
  return texte
}

async function main() {
  const opts = lireOptions()
  // Variables manquantes dans le .env : on s'arrête avant de créer quoi que ce soit.
  await compose('config', '--quiet')
  const contexte = await contexteCampagne(opts.scenario)
  const dossier = join(RACINE, 'charge-resultats', contexte.campagne)
  mkdirSync(dossier, { recursive: true })
  console.log(`Campagne ${contexte.campagne}, scénario ${opts.scenario}. Résultats dans ${relative(RACINE, dossier)}.`)

  if (opts.build) await compose('build')
  const lignes = []
  for (const passage of SCENARIOS[opts.scenario]) {
    for (let essai = 1; essai <= passage.essais; essai++) {
      const libelle = `${passage.libelle}-${essai}`
      console.log(`\n=== ${libelle} : remise à zéro de la pile ===`)
      await compose('down', '-v')
      await compose('up', '-d')
      await attendreSante()
      await sleep(opts.pauseMs)
      const resume = await lancerCharge(passage, libelle, join(dossier, `${libelle}.json`))
      const coherence = resume.verdict === 'interrompu' ? null : await verifierCoherence(resume)
      lignes.push(ligneHistorique(resume, contexte, essai, coherence))
    }
  }
  await compose('down', '-v')

  const comparaison = comparer(lignes, lireHistorique(HISTORIQUE))
  ajouterHistorique(HISTORIQUE, lignes)
  console.log(`\n${ecrireResume(dossier, contexte, lignes, comparaison)}`)
  console.log(`${lignes.length} ligne(s) ajoutée(s) à ${relative(RACINE, HISTORIQUE)} : à committer pour garder cette campagne.`)

  const enEchec = lignes.some((l) => l.verdict !== 'reussi' || l.coherence !== true)
  const regression = comparaison.some((c) => c.regressions.length > 0)
  process.exit(enEchec || regression ? 1 : 0)
}

main().catch((e) => {
  console.error(`Échec de la campagne : ${e.message}`)
  process.exit(1)
})
