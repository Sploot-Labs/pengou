import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ajouterHistorique, comparer, ligneHistorique, lireHistorique } from './historique.mjs'

const MACHINE = {
  cpu: 'AMD Ryzen 9 4900HS with Radeon Graphics',
  coeurs: 16,
  memGo: 31.4,
  dockerCpus: 16,
  dockerMemGo: 15.3,
}

const contexte = (campagne, machine = MACHINE) => ({
  campagne,
  scenario: 'rapide',
  commit: 'abc1234',
  modifie: false,
  machine,
})

const resumeReussi = {
  libelle: 'p800-1',
  parametres: { joueurs: 800, parties: 1, questions: 10, cadence: 25, processus: 8, docker: 'pengou-charge' },
  latences: {
    join: { n: 800, p50: 12, p95: 35, p99: 50, max: 60 },
    reponse: { n: 8000, p50: 3, p95: 5.9, p99: 9, max: 20 },
    diffusion: { n: 10, p50: 100, p95: 149, p99: 149, max: 149 },
    diffusionPremiereMs: 149,
  },
  serveur: { lagP99MaxMs: 83.1, lagP95Ms: 60, secondesLagAuDessus: 0, rssMaxMo: 388.5 },
  docker: {
    'pengou-charge-app-1': { cpuMaxPct: 89, memMaxMo: 380 },
    'pengou-charge-db-1': { cpuMaxPct: 60, memMaxMo: 90 },
  },
  criteres: { rejointTous: true, lagServeurP99: true },
  verdict: 'reussi',
}

/** Ligne de référence ou nouvelle ligne, avec quelques champs remplacés. */
const ligne = (campagne, champs = {}, machine = MACHINE) => ({
  ...ligneHistorique(resumeReussi, contexte(campagne, machine), 1, true),
  ...champs,
})

describe('ligneHistorique', () => {
  it('extrait les chiffres clés', () => {
    const l = ligneHistorique(resumeReussi, contexte('c1'), 1, true)
    expect(l).toMatchObject({
      campagne: 'c1',
      scenario: 'rapide',
      commit: 'abc1234',
      libelle: 'p800-1',
      essai: 1,
      cle: '1x800@25',
      joueurs: 800,
      parties: 1,
      cadence: 25,
      questions: 10,
      verdict: 'reussi',
      criteresEchoues: [],
      joinP95: 35,
      reponseP95: 5.9,
      diffusionP95: 149,
      diffusionPremiereMs: 149,
      lagP99MaxMs: 83.1,
      lagP95Ms: 60,
      secondesLagAuDessus: 0,
      cpuAppMaxPct: 89,
      cpuDbMaxPct: 60,
      rssMaxMo: 388.5,
      coherence: true,
    })
  })

  it('liste les critères en échec', () => {
    const l = ligneHistorique(
      { ...resumeReussi, criteres: { rejointTous: true, lagServeurP99: false }, verdict: 'echoue' },
      contexte('c1'),
      1,
      true,
    )
    expect(l.criteresEchoues).toEqual(['lagServeurP99'])
  })

  it('accepte un résumé interrompu', () => {
    const interrompu = {
      libelle: 'p800-1',
      parametres: resumeReussi.parametres,
      verdict: 'interrompu',
      erreur: 'host:start : pas de réponse du serveur',
    }
    const l = ligneHistorique(interrompu, contexte('c1'), 1, null)
    expect(l.verdict).toBe('interrompu')
    expect(l.cle).toBe('1x800@25')
    expect(l.reponseP95).toBeNull()
    expect(l.lagP95Ms).toBeNull()
    expect(l.cpuAppMaxPct).toBeNull()
    expect(l.criteresEchoues).toEqual([])
  })
})

describe('comparer', () => {
  it('comparer sans référence', () => {
    expect(comparer([ligne('c2')], [])).toEqual([{ cle: '1x800@25', reference: null, regressions: [] }])
  })

  it('ignore les lignes de la campagne en cours', () => {
    expect(comparer([ligne('c2')], [ligne('c2')])[0].reference).toBeNull()
  })

  it('compare à la campagne comparable la plus récente', () => {
    const historique = [ligne('c0', { lagP95Ms: 10 }), ligne('c1', { lagP95Ms: 40 })]
    const [r] = comparer([ligne('c2', { lagP95Ms: 95 })], historique)
    expect(r.reference).toBe('c1')
    expect(r.regressions).toContain('lagP95Ms 40 -> 95')
  })

  it('comparer signale une régression de lag', () => {
    const [r] = comparer([ligne('c2', { lagP95Ms: 95 })], [ligne('c1', { lagP95Ms: 40 })])
    expect(r.regressions).toContain('lagP95Ms 40 -> 95')
  })

  it('compare la moyenne des essais', () => {
    const nouvelles = [ligne('c2', { lagP95Ms: 50 }), ligne('c2', { essai: 2, lagP95Ms: 130 })]
    const [r] = comparer(nouvelles, [ligne('c1', { lagP95Ms: 40 })])
    expect(r.regressions).toContain('lagP95Ms 40 -> 90')
  })

  it('comparer ignore une petite hausse', () => {
    const [r] = comparer([ligne('c2', { reponseP95: 9 })], [ligne('c1', { reponseP95: 4 })])
    expect(r.regressions).toEqual([])
  })

  it('comparer signale un verdict perdu', () => {
    const [r] = comparer([ligne('c2', { verdict: 'echoue' })], [ligne('c1')])
    expect(r.regressions).toContain('verdict reussi -> echoue')
  })

  it('ignore une valeur absente', () => {
    const [r] = comparer([ligne('c2', { verdict: 'interrompu', lagP95Ms: null })], [ligne('c1')])
    expect(r.regressions).toEqual(['verdict reussi -> interrompu'])
  })

  it("ignore d'autres limites de conteneur", () => {
    const limites4 = { ...MACHINE, limites: { cpus: 4, memMo: 15360 } }
    const limites16 = { ...MACHINE, limites: { cpus: 16, memMo: 15360 } }
    const [r] = comparer([ligne('c2', {}, limites16)], [ligne('c1', {}, limites4)])
    expect(r.reference).toBeNull()
    const [r2] = comparer([ligne('c2', {}, limites4)], [ligne('c1', {}, { ...limites4 })])
    expect(r2.reference).toBe('c1')
  })

  it('comparer ignore une autre machine', () => {
    const autre = { ...MACHINE, cpu: 'Intel Xeon' }
    const [r] = comparer([ligne('c2')], [ligne('c1', {}, autre)])
    expect(r.reference).toBeNull()
  })

  it("rend une entrée par clé, dans l'ordre des passages", () => {
    const etab = { ...ligne('c2'), cle: '10x30@25' }
    expect(comparer([ligne('c2'), etab], []).map((r) => r.cle)).toEqual(['1x800@25', '10x30@25'])
  })
})

describe('lireHistorique et ajouterHistorique', () => {
  it('renvoie une liste vide si le fichier est absent', () => {
    expect(lireHistorique(join(mkdtempSync(join(tmpdir(), 'hist-')), 'absent.jsonl'))).toEqual([])
  })

  it('lireHistorique ignore une ligne invalide', () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'hist-')), 'h.jsonl')
    writeFileSync(chemin, `${JSON.stringify(ligne('c1'))}\n{tronq\n\n`)
    expect(lireHistorique(chemin)).toHaveLength(1)
  })

  it("ajoute le saut de ligne final manquant avant d'ajouter", () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'hist-')), 'h.jsonl')
    writeFileSync(
      chemin,
      `${JSON.stringify(ligne('c0'))}
${JSON.stringify(ligne('c1'))}`,
    )
    ajouterHistorique(chemin, [ligne('c2')])
    expect(lireHistorique(chemin).map((l) => l.campagne)).toEqual(['c0', 'c1', 'c2'])
  })

  it('ajoute une ligne par entrée sans réécrire', () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'hist-')), 'h.jsonl')
    ajouterHistorique(chemin, [ligne('c1')])
    ajouterHistorique(chemin, [ligne('c2'), ligne('c2', { essai: 2 })])
    expect(lireHistorique(chemin).map((l) => l.campagne)).toEqual(['c1', 'c2', 'c2'])
  })
})
