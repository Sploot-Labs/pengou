// Historique compact des passages de charge : une ligne JSON par passage dans un fichier en ajout
// seul (docs/charge/historique.jsonl), et comparaison d'une campagne à la précédente comparable.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

// Une mesure dégradée signale une régression si elle dépasse à la fois ce facteur et cet écart.
const FACTEUR_REGRESSION = 1.5
const ECART_REGRESSION_MS = 20
const MESURES_COMPAREES = ['reponseP95', 'diffusionP95', 'lagP95Ms', 'joinP95']

const ouNull = (x) => (x === undefined || (typeof x === 'number' && !Number.isFinite(x)) ? null : x)

/** CPU max relevé par Docker pour le conteneur dont le nom finit par `suffixe`, sinon null. */
function cpuConteneur(docker, suffixe) {
  const nom = Object.keys(docker ?? {}).find((n) => n.endsWith(suffixe))
  return nom ? ouNull(docker[nom].cpuMaxPct) : null
}

/** Ligne d'historique d'un passage ; un résumé interrompu donne des mesures à null. */
export function ligneHistorique(resume, contexte, essai, coherence) {
  const { joueurs, parties, cadence, questions } = resume.parametres
  const latences = resume.latences ?? {}
  const serveur = resume.serveur ?? {}
  return {
    campagne: contexte.campagne,
    scenario: contexte.scenario,
    commit: contexte.commit,
    modifie: contexte.modifie,
    machine: contexte.machine,
    libelle: resume.libelle,
    essai,
    cle: `${parties}x${joueurs}@${cadence}`,
    joueurs,
    parties,
    cadence,
    questions,
    verdict: resume.verdict,
    criteresEchoues: Object.entries(resume.criteres ?? {})
      .filter(([, ok]) => !ok)
      .map(([nom]) => nom),
    joinP95: ouNull(latences.join?.p95),
    reponseP95: ouNull(latences.reponse?.p95),
    diffusionP95: ouNull(latences.diffusion?.p95),
    diffusionPremiereMs: ouNull(latences.diffusionPremiereMs),
    lagP99MaxMs: ouNull(serveur.lagP99MaxMs),
    lagP95Ms: ouNull(serveur.lagP95Ms),
    secondesLagAuDessus: ouNull(serveur.secondesLagAuDessus),
    cpuAppMaxPct: cpuConteneur(resume.docker, '-app-1'),
    cpuDbMaxPct: cpuConteneur(resume.docker, '-db-1'),
    rssMaxMo: ouNull(serveur.rssMaxMo),
    coherence,
  }
}

/** Lignes de l'historique ; fichier absent : liste vide, ligne illisible : ignorée. */
export function lireHistorique(chemin) {
  if (!existsSync(chemin)) return []
  const lignes = []
  for (const texte of readFileSync(chemin, 'utf8').split('\n')) {
    if (!texte.trim()) continue
    try {
      lignes.push(JSON.parse(texte))
    } catch {
      // Ligne tronquée ou conflit de fusion : on la saute plutôt que de perdre tout l'historique.
    }
  }
  return lignes
}

export function ajouterHistorique(chemin, lignes) {
  appendFileSync(chemin, lignes.map((l) => `${JSON.stringify(l)}\n`).join(''))
}

/** Moyenne des valeurs non nulles d'une mesure, arrondie au dixième ; null s'il n'y en a aucune. */
function moyenne(lignes, mesure) {
  const valeurs = lignes.map((l) => l[mesure]).filter((x) => typeof x === 'number')
  if (valeurs.length === 0) return null
  return Math.round((valeurs.reduce((a, b) => a + b, 0) / valeurs.length) * 10) / 10
}

/**
 * Compare chaque clé de passage de la campagne en cours à la campagne la plus récente de
 * l'historique (ordre du fichier) ayant la même clé et le même CPU. Les essais d'une même clé
 * sont moyennés de part et d'autre.
 */
export function comparer(nouvelles, historique) {
  const campagne = nouvelles[0]?.campagne
  const cles = [...new Set(nouvelles.map((l) => l.cle))]
  return cles.map((cle) => {
    const actuelles = nouvelles.filter((l) => l.cle === cle)
    const cpu = actuelles[0].machine?.cpu
    const candidates = historique.filter((l) => l.cle === cle && l.campagne !== campagne && l.machine?.cpu === cpu)
    if (candidates.length === 0) return { cle, reference: null, regressions: [] }
    const reference = candidates[candidates.length - 1].campagne
    const anciennes = candidates.filter((l) => l.campagne === reference)

    const regressions = []
    const verdictActuel = actuelles.find((l) => l.verdict !== 'reussi')?.verdict ?? 'reussi'
    if (anciennes.every((l) => l.verdict === 'reussi') && verdictActuel !== 'reussi') {
      regressions.push(`verdict reussi -> ${verdictActuel}`)
    }
    for (const mesure of MESURES_COMPAREES) {
      const avant = moyenne(anciennes, mesure)
      const apres = moyenne(actuelles, mesure)
      if (avant === null || apres === null) continue
      if (apres > avant * FACTEUR_REGRESSION && apres - avant >= ECART_REGRESSION_MS) {
        regressions.push(`${mesure} ${avant} -> ${apres}`)
      }
    }
    return { cle, reference, regressions }
  })
}
