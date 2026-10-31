// Mesures côté serveur pendant un palier : échantillonnage de /metrics (format texte Prometheus,
// métriques par défaut de prom-client) et, avec --docker, de `docker stats`.
//
// prom-client 15 remet l'histogramme d'event loop à zéro à chaque lecture de /metrics : chaque
// échantillon est donc le p99 de la seconde écoulée. Personne d'autre ne doit lire /metrics
// pendant un palier, sinon les fenêtres rétrécissent.
import { execFile } from 'node:child_process'

/** Valeur numérique d'une métrique sans étiquette dans un texte Prometheus ; `NaN` si absente. */
function valeurMetrique(texte, nom) {
  for (const ligne of texte.split('\n')) {
    if (!ligne.startsWith(nom)) continue
    const reste = ligne.slice(nom.length)
    // Le nom doit être suivi d'un espace (ou d'étiquettes) : on évite les préfixes communs.
    if (reste[0] !== ' ' && reste[0] !== '{') continue
    const valeur = Number(reste.slice(reste.lastIndexOf(' ') + 1))
    if (Number.isFinite(valeur)) return valeur
  }
  return Number.NaN
}

const MO = 1024 * 1024
const DELAI_LECTURE_MS = 2000

/** Extrait du texte de /metrics les quatre mesures utiles (lag en ms, mémoire en Mo, CPU en secondes). */
export function lireMetriques(texte) {
  return {
    lagP99Ms: valeurMetrique(texte, 'nodejs_eventloop_lag_p99_seconds') * 1000,
    rssMo: valeurMetrique(texte, 'process_resident_memory_bytes') / MO,
    heapMo: valeurMetrique(texte, 'nodejs_heap_size_used_bytes') / MO,
    cpuSecondes: valeurMetrique(texte, 'process_cpu_seconds_total'),
  }
}

// Maximum d'une série ; `NaN` si elle est vide (aucune mesure ne doit passer pour un zéro).
const maxDe = (valeurs) => (valeurs.length === 0 ? Number.NaN : Math.max(...valeurs))
const auDixieme = (x) => Math.round(x * 10) / 10

/**
 * Lit /metrics toutes les `periodeMs`. Une lecture initiale sert de référence (CPU, remise à zéro
 * du lag) et une lecture finale ferme la dernière fenêtre ; seules les lectures suivantes comptent.
 */
export function echantillonnerServeur(cible, periodeMs = 1000) {
  const lag = []
  const rss = []
  const heap = []
  const cpu = []
  let precedent = null
  let enCours = Promise.resolve()

  const lire = async () => {
    try {
      const res = await fetch(`${cible}/metrics`, { signal: AbortSignal.timeout(DELAI_LECTURE_MS) })
      if (!res.ok) return
      const maintenant = Date.now()
      const m = lireMetriques(await res.text())
      if (precedent) {
        if (Number.isFinite(m.lagP99Ms)) lag.push(m.lagP99Ms)
        if (Number.isFinite(m.rssMo)) rss.push(m.rssMo)
        if (Number.isFinite(m.heapMo)) heap.push(m.heapMo)
        const dt = (maintenant - precedent.t) / 1000
        if (dt > 0 && Number.isFinite(m.cpuSecondes)) cpu.push(((m.cpuSecondes - precedent.cpu) / dt) * 100)
      }
      precedent = { t: maintenant, cpu: m.cpuSecondes }
    } catch {
      // Une lecture ratée est simplement absente des échantillons.
    }
  }
  const planifier = () => {
    enCours = enCours.then(lire)
    return enCours
  }

  planifier()
  const minuteur = setInterval(planifier, periodeMs)
  return {
    async arreter() {
      clearInterval(minuteur)
      await planifier()
      return {
        lagP99MaxMs: auDixieme(maxDe(lag)),
        rssMaxMo: auDixieme(maxDe(rss)),
        heapMaxMo: auDixieme(maxDe(heap)),
        cpuMoyenPct: cpu.length ? auDixieme(cpu.reduce((a, b) => a + b, 0) / cpu.length) : Number.NaN,
        cpuMaxPct: auDixieme(maxDe(cpu)),
        echantillons: lag.length,
      }
    },
  }
}

/** Convertit « 123.4MiB » ou « 1.2GiB » en Mo ; 0 si le format est inconnu. */
function enMo(texte) {
  const m = /^([\d.]+)\s*([KMG]i?B|B)$/i.exec(texte.trim())
  if (!m) return 0
  const facteurs = { B: 1 / MO, KIB: 1 / 1024, KB: 1 / 1024, MIB: 1, MB: 1, GIB: 1024, GB: 1024 }
  return Number(m[1]) * (facteurs[m[2].toUpperCase()] ?? 0)
}

function lireDockerStats() {
  return new Promise((ok) => {
    execFile('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeout: 20_000 }, (err, sortie) => {
      if (err) return ok([])
      const lignes = []
      for (const ligne of sortie.split('\n')) {
        try {
          if (ligne.trim()) lignes.push(JSON.parse(ligne))
        } catch {
          // Ligne illisible ignorée.
        }
      }
      ok(lignes)
    })
  })
}

/** Échantillonne `docker stats` pour les conteneurs du projet Compose ; renvoie le maximum par conteneur. */
export function echantillonnerDocker(projet, periodeMs = 5000) {
  const maxima = {}
  let enCours = Promise.resolve()
  const lire = async () => {
    for (const c of await lireDockerStats()) {
      const nom = c.Name ?? ''
      if (!nom.startsWith(`${projet}-`) && !nom.startsWith(`${projet}_`)) continue
      const cpuPct = Number.parseFloat(c.CPUPerc) || 0
      const memMo = enMo(String(c.MemUsage ?? '').split('/')[0])
      const actuel = maxima[nom] ?? { cpuMaxPct: 0, memMaxMo: 0 }
      maxima[nom] = { cpuMaxPct: Math.max(actuel.cpuMaxPct, cpuPct), memMaxMo: Math.max(actuel.memMaxMo, auDixieme(memMo)) }
    }
  }
  const planifier = () => {
    enCours = enCours.then(lire)
    return enCours
  }
  planifier()
  const minuteur = setInterval(planifier, periodeMs)
  return {
    async arreter() {
      clearInterval(minuteur)
      await enCours
      return maxima
    },
  }
}
