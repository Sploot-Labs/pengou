// Fonctions pures du générateur de charge : percentiles, résumé d'une série de latences et garde
// de cible (le test de charge ne vise que la boucle locale).

/** Percentile par la méthode du rang le plus proche, sur une copie triée. `NaN` si la liste est vide. */
export function percentile(valeurs, p) {
  if (valeurs.length === 0) return Number.NaN
  const tri = [...valeurs].sort((a, b) => a - b)
  const rang = Math.min(tri.length, Math.max(1, Math.ceil((p / 100) * tri.length)))
  return tri[rang - 1]
}

const auDixieme = (x) => Math.round(x * 10) / 10

/** Résumé d'une série en millisecondes : effectif, p50, p95, p99 et maximum, arrondis au dixième. */
export function resumer(valeurs) {
  return {
    n: valeurs.length,
    p50: auDixieme(percentile(valeurs, 50)),
    p95: auDixieme(percentile(valeurs, 95)),
    p99: auDixieme(percentile(valeurs, 99)),
    max: auDixieme(percentile(valeurs, 100)),
  }
}

const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Vrai si l'URL désigne la boucle locale (localhost, 127.0.0.1 ou ::1). Une URL invalide est refusée. */
export function estCibleLocale(url) {
  let hote
  try {
    hote = new URL(url).hostname
  } catch {
    return false
  }
  return HOTES_LOCAUX.has(hote)
}

// Seuils de verdict d'un palier.
export const REPONSE_P95_MAX_MS = 300
export const DIFFUSION_P95_MAX_MS = 1000
export const LAG_SERVEUR_P99_MAX_MS = 200
export const LAG_GENERATEUR_P99_MAX_MS = 100

/**
 * Verdict d'un palier à partir du résumé JSON. `invalide` si le générateur lui-même est saturé ou
 * si l'horloge est incohérente (la mesure ne vaut rien) ; sinon `reussi` si les cinq critères
 * tiennent, `echoue` sinon. Une valeur manquante (NaN) fait échouer son critère.
 */
export function verdict(resume) {
  const criteres = {
    rejointTous: resume.joueurs.rejoints === resume.joueurs.tentes,
    zeroDeconnexion: resume.deconnexions === 0,
    reponseP95: resume.latences.reponse.p95 <= REPONSE_P95_MAX_MS,
    diffusionP95: resume.latences.diffusion.p95 <= DIFFUSION_P95_MAX_MS,
    lagServeurP99: resume.serveur.lagP99MaxMs <= LAG_SERVEUR_P99_MAX_MS,
  }
  if (resume.generateur.lagP99MaxMs > LAG_GENERATEUR_P99_MAX_MS || resume.horlogeIncoherente > 0) {
    return { criteres, verdict: 'invalide' }
  }
  return { criteres, verdict: Object.values(criteres).every(Boolean) ? 'reussi' : 'echoue' }
}
