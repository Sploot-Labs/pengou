import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { echantillonnerServeur, lireMetriques } from './metriques.mjs'
import { estCibleLocale, percentile, resumer, resumerLag, verdict } from './stats.mjs'

describe('percentile (rang le plus proche)', () => {
  it('renvoie NaN pour une liste vide', () => {
    expect(percentile([], 50)).toBeNaN()
  })

  it('renvoie la seule valeur pour une liste à un élément', () => {
    expect(percentile([42], 0)).toBe(42)
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 100)).toBe(42)
  })

  it('applique le rang le plus proche sur 1..10', () => {
    const v = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
    expect(percentile(v, 50)).toBe(5)
    expect(percentile(v, 90)).toBe(9)
    expect(percentile(v, 95)).toBe(10)
    expect(percentile(v, 99)).toBe(10)
    expect(percentile(v, 100)).toBe(10)
    expect(percentile(v, 0)).toBe(1)
  })

  it('applique le rang le plus proche sur 1..100', () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i)
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(95)
    expect(percentile(v, 99)).toBe(99)
    expect(percentile(v, 99.5)).toBe(100)
  })

  it('ne modifie pas le tableau reçu', () => {
    const v = [3, 1, 2]
    percentile(v, 50)
    expect(v).toEqual([3, 1, 2])
  })
})

describe('resumer', () => {
  it('donne n, p50, p95, p99 et max arrondis au dixième', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1 + 0.04)
    expect(resumer(v)).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, max: 100 })
  })

  it('arrondit au dixième le plus proche', () => {
    expect(resumer([1.26])).toEqual({ n: 1, p50: 1.3, p95: 1.3, p99: 1.3, max: 1.3 })
  })

  it('renvoie n = 0 et des NaN pour une liste vide', () => {
    const r = resumer([])
    expect(r.n).toBe(0)
    expect(r.p50).toBeNaN()
    expect(r.p95).toBeNaN()
    expect(r.p99).toBeNaN()
    expect(r.max).toBeNaN()
  })
})

describe('estCibleLocale', () => {
  it.each([
    'http://localhost:3000',
    'http://localhost',
    'https://localhost:8443/chemin',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'http://LOCALHOST:3000',
  ])('accepte %s', (url) => {
    expect(estCibleLocale(url)).toBe(true)
  })

  it.each([
    'https://example.org',
    'http://localhost.example.org',
    'http://127.0.0.2:3000',
    'http://10.0.0.1:3000',
    'http://0.0.0.0:3000',
    'localhost:3000',
    'pas une url',
    '',
  ])('refuse %s', (url) => {
    expect(estCibleLocale(url)).toBe(false)
  })
})

function resumeType(surcharges = {}) {
  return {
    joueurs: { tentes: 10, rejoints: 10 },
    deconnexions: 0,
    erreurs: { ackTimeout: 0, reponseRefusee: 0, connexion: 0 },
    parametres: { questions: 10 },
    parties: [{ rejoints: 10, reponsesAcceptees: 100 }],
    horlogeIncoherente: 0,
    latences: { reponse: { p95: 50 }, diffusion: { p95: 200 } },
    serveur: { lagP99MaxMs: 20, echantillons: 5 },
    generateur: { lagP99MaxMs: 5 },
    ...surcharges,
  }
}

describe('verdict', () => {
  it('echoue sur un ackTimeout ou une réponse manquante', () => {
    expect(verdict(resumeType()).criteres).toMatchObject({ zeroErreur: true, toutesReponses: true })
    const avecTimeout = verdict(resumeType({ erreurs: { ackTimeout: 1, reponseRefusee: 0, connexion: 0 } }))
    expect(avecTimeout.criteres.zeroErreur).toBe(false)
    expect(avecTimeout.verdict).toBe('echoue')
    const manquante = verdict(resumeType({ parties: [{ rejoints: 10, reponsesAcceptees: 99 }] }))
    expect(manquante.criteres.toutesReponses).toBe(false)
    expect(manquante.verdict).toBe('echoue')
  })

  it('reussi quand les sept critères tiennent', () => {
    const v = verdict(resumeType())
    expect(v.verdict).toBe('reussi')
    expect(Object.values(v.criteres).every(Boolean)).toBe(true)
  })

  it('echoue et désigne le critère manqué', () => {
    const v = verdict(resumeType({ joueurs: { tentes: 10, rejoints: 8 } }))
    expect(v.verdict).toBe('echoue')
    expect(v.criteres.rejointTous).toBe(false)
    expect(verdict(resumeType({ deconnexions: 1 })).criteres.zeroDeconnexion).toBe(false)
    expect(
      verdict(resumeType({ latences: { reponse: { p95: 301 }, diffusion: { p95: 200 } } })).criteres.reponseP95,
    ).toBe(false)
    expect(
      verdict(resumeType({ latences: { reponse: { p95: 50 }, diffusion: { p95: 1001 } } })).criteres.diffusionP95,
    ).toBe(false)
    expect(verdict(resumeType({ serveur: { lagP99MaxMs: 201, echantillons: 5 } })).criteres.lagServeurP99).toBe(false)
  })

  it('accepte les valeurs exactement égales aux seuils', () => {
    const v = verdict(
      resumeType({
        latences: { reponse: { p95: 300 }, diffusion: { p95: 1000 } },
        serveur: { lagP99MaxMs: 200, echantillons: 5 },
      }),
    )
    expect(v.verdict).toBe('reussi')
  })

  it('une latence absente (NaN) fait échouer son critère', () => {
    expect(verdict(resumeType({ latences: { reponse: { p95: Number.NaN }, diffusion: { p95: 1 } } })).verdict).toBe(
      'echoue',
    )
  })

  it('invalide si le générateur sature, même avec des critères en échec', () => {
    const v = verdict(resumeType({ generateur: { lagP99MaxMs: 100.1 }, deconnexions: 3 }))
    expect(v.verdict).toBe('invalide')
    expect(verdict(resumeType({ generateur: { lagP99MaxMs: 100 } })).verdict).toBe('reussi')
  })

  it('echoue sans échantillon serveur, même avec un lag à 0 ou absent', () => {
    expect(verdict(resumeType({ serveur: { lagP99MaxMs: 0, echantillons: 0 } })).criteres.lagServeurP99).toBe(false)
    expect(verdict(resumeType({ serveur: { lagP99MaxMs: Number.NaN, echantillons: 0 } })).verdict).toBe('echoue')
    expect(verdict(resumeType({ serveur: { lagP99MaxMs: 0 } })).criteres.lagServeurP99).toBe(false)
  })

  it('invalide si la mesure du générateur est manquante', () => {
    expect(verdict(resumeType({ generateur: { lagP99MaxMs: Number.NaN } })).verdict).toBe('invalide')
    expect(verdict(resumeType({ generateur: {} })).verdict).toBe('invalide')
  })

  it('invalide si une horloge est incohérente', () => {
    expect(verdict(resumeType({ horlogeIncoherente: 1 })).verdict).toBe('invalide')
  })
})

describe('lireMetriques', () => {
  const texte = [
    '# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.',
    '# TYPE process_cpu_seconds_total counter',
    'process_cpu_seconds_total 12.5',
    'process_resident_memory_bytes 104857600',
    'nodejs_eventloop_lag_p99_seconds_extra 9',
    'nodejs_eventloop_lag_p99_seconds 0.0123',
    'nodejs_heap_size_used_bytes 52428800',
  ].join('\n')

  it('convertit les unités et ignore les noms voisins', () => {
    const m = lireMetriques(texte)
    expect(m.lagP99Ms).toBeCloseTo(12.3, 5)
    expect(m.rssMo).toBe(100)
    expect(m.heapMo).toBe(50)
    expect(m.cpuSecondes).toBe(12.5)
  })

  it('renvoie NaN pour une métrique absente', () => {
    expect(lireMetriques('').rssMo).toBeNaN()
  })
})

describe('echantillonnerServeur', () => {
  it('renvoie NaN et zéro échantillon quand /metrics est injoignable', async () => {
    const mesures = await echantillonnerServeur('http://127.0.0.1:1', 50).arreter()
    expect(mesures.echantillons).toBe(0)
    expect(mesures.lagP99MaxMs).toBeNaN()
    expect(mesures.rssMaxMo).toBeNaN()
    expect(mesures.cpuMoyenPct).toBeNaN()
  })

  it("ne s'empile pas derrière un /metrics qui ne répond jamais", async () => {
    const sockets = new Set()
    const serveur = createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => {})
    })
    await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok))
    try {
      const echantillonneur = echantillonnerServeur(`http://127.0.0.1:${serveur.address().port}`, 100)
      await new Promise((ok) => setTimeout(ok, 3000))
      const debut = Date.now()
      const mesures = await echantillonneur.arreter()
      expect(Date.now() - debut).toBeLessThan(2500)
      expect(mesures.echantillons).toBe(0)
    } finally {
      for (const socket of sockets) socket.destroy()
      serveur.close()
    }
  }, 15_000)
})

describe('resumerLag', () => {
  it('donne le p95 et le nombre de secondes au-dessus du seuil', () => {
    const r = resumerLag([10, 20, 30, 250, 40, 50, 60, 70, 80, 300], 200)
    expect(r).toEqual({ p95: 300, auDessus: 2 })
  })

  it('renvoie NaN et 0 sans échantillon', () => {
    const r = resumerLag([], 200)
    expect(r.p95).toBeNaN()
    expect(r.auDessus).toBe(0)
  })
})
