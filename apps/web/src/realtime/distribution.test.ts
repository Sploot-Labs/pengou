import { sliderTolerance } from '@splootlabs/quiz'
import { describe, expect, it } from 'vitest'
import { buildDistributionRows, pollRows } from './distribution.js'

/**
 * `buildDistributionRows` décode `question:reveal.distribution`, indexée par
 * `JSON.stringify(réponse soumise)` (voir `packages/game/src/engine.ts`,
 * `questionResult()`) — ces tests figent cet encodage exact pour les 4 types
 * de question, plus le cas d'une clé inattendue (jamais de crash : le
 * serveur/le réseau ne sont pas une source de confiance absolue).
 */

describe('buildDistributionRows — mcq', () => {
  const correct = {
    options: [
      { label: 'Lyon', correct: false },
      { label: 'Paris', correct: true },
      { label: 'Marseille', correct: false },
    ],
  }

  it('compte chaque option par index (optionIndex), pas par label', () => {
    const distribution = {
      [JSON.stringify({ optionIndex: 0 })]: 1,
      [JSON.stringify({ optionIndex: 1 })]: 4,
    }
    const rows = buildDistributionRows('mcq', correct, distribution)
    expect(rows).toEqual([
      { key: '0', label: 'Lyon', correct: false, shape: 'triangle', count: 1 },
      { key: '1', label: 'Paris', correct: true, shape: 'diamond', count: 4 },
      { key: '2', label: 'Marseille', correct: false, shape: 'circle', count: 0 },
    ])
  })

  it('une clé absente de la distribution vaut 0, jamais undefined/NaN', () => {
    const rows = buildDistributionRows('mcq', correct, {})
    expect(rows.every((r) => r.count === 0)).toBe(true)
  })
})

describe('buildDistributionRows — truefalse', () => {
  it('décode {value:true}/{value:false} et marque la bonne réponse', () => {
    const distribution = {
      [JSON.stringify({ value: true })]: 3,
      [JSON.stringify({ value: false })]: 1,
    }
    const rows = buildDistributionRows('truefalse', { correct: true }, distribution)
    expect(rows).toEqual([
      { key: 'true', label: 'Vrai', correct: true, shape: null, count: 3 },
      { key: 'false', label: 'Faux', correct: false, shape: null, count: 1 },
    ])
  })
})

describe('buildDistributionRows — slider', () => {
  const correct = { min: 0, max: 100, correct: 50 }

  it('liste les valeurs EXACTES reçues, triées, sans regroupement en tranches', () => {
    const distribution = {
      [JSON.stringify({ value: 90 })]: 1,
      [JSON.stringify({ value: 10 })]: 1,
      [JSON.stringify({ value: 52 })]: 2,
    }
    const rows = buildDistributionRows('slider', correct, distribution)
    expect(rows.map((r) => r.label)).toEqual(['10', '52', '90'])
  })

  it('marque « correct » exactement selon sliderTolerance (5% de [min,max], jamais une formule dupliquée)', () => {
    const tol = sliderTolerance(correct.min, correct.max)
    const distribution = {
      [JSON.stringify({ value: correct.correct + tol })]: 1, // pile à la limite → dans la tolérance
      [JSON.stringify({ value: correct.correct + tol + 1 })]: 1, // juste hors tolérance
    }
    const rows = buildDistributionRows('slider', correct, distribution)
    const within = rows.find((r) => r.label === String(correct.correct + tol))
    const outside = rows.find((r) => r.label === String(correct.correct + tol + 1))
    expect(within?.correct).toBe(true)
    expect(outside?.correct).toBe(false)
  })
})

describe('buildDistributionRows — text', () => {
  it('décode {text:"..."}, trie par fréquence décroissante, plie accents/casse pour la correction', () => {
    const correct = { answers: ['Reykjavik'], caseSensitive: false }
    const distribution = {
      [JSON.stringify({ text: 'Reykjavík' })]: 1, // accentué, casse différente — doit compter correct
      [JSON.stringify({ text: 'Oslo' })]: 3,
    }
    const rows = buildDistributionRows('text', correct, distribution)
    expect(rows[0]).toEqual({ key: 'Oslo', label: 'Oslo', correct: false, shape: null, count: 3 })
    expect(rows[1]).toEqual({ key: 'Reykjavík', label: 'Reykjavík', correct: true, shape: null, count: 1 })
  })

  it('réponse vide affichée avec un libellé explicite, pas une chaîne vide brute', () => {
    const rows = buildDistributionRows(
      'text',
      { answers: ['x'] },
      { [JSON.stringify({ text: '' })]: 2 },
    )
    expect(rows).toEqual([{ key: '', label: '(réponse vide)', correct: false, shape: null, count: 2 }])
  })
})

describe('buildDistributionRows — clés inattendues (jamais de crash)', () => {
  it('une clé qui n’est pas du JSON valide est ignorée par slider/text, pas jetée', () => {
    const distribution = { 'pas-du-json{': 1, [JSON.stringify({ value: 5 })]: 2 }
    expect(() => buildDistributionRows('slider', { min: 0, max: 10, correct: 5 }, distribution)).not.toThrow()
    const rows = buildDistributionRows('slider', { min: 0, max: 10, correct: 5 }, distribution)
    expect(rows).toEqual([{ key: '5', label: '5', correct: true, shape: null, count: 2 }])
  })

  it('un JSON valide mais de forme inattendue (ni {value}, ni {text}) est ignoré sans planter', () => {
    const distribution = { [JSON.stringify({ surprise: 42 })]: 1 }
    expect(() =>
      buildDistributionRows('slider', { min: 0, max: 10, correct: 5 }, distribution),
    ).not.toThrow()
    expect(buildDistributionRows('slider', { min: 0, max: 10, correct: 5 }, distribution)).toEqual([])
    expect(() =>
      buildDistributionRows('text', { answers: ['x'] }, distribution),
    ).not.toThrow()
    expect(buildDistributionRows('text', { answers: ['x'] }, distribution)).toEqual([])
  })

  it('une distribution vide ne plante pas pour aucun type', () => {
    expect(buildDistributionRows('mcq', { options: [{ label: 'A', correct: true }] }, {})).toEqual([
      { key: '0', label: 'A', correct: true, shape: 'triangle', count: 0 },
    ])
    expect(buildDistributionRows('truefalse', { correct: false }, {})).toHaveLength(2)
    expect(buildDistributionRows('slider', { min: 0, max: 10, correct: 5 }, {})).toEqual([])
    expect(buildDistributionRows('text', { answers: ['x'] }, {})).toEqual([])
  })
})

describe('pollRows', () => {
  it("donne une ligne par option, dans l'ordre, sans jamais marquer de bonne réponse", () => {
    const rows = pollRows({
      questionId: 'q1',
      multiple: true,
      voters: 3,
      options: [
        { label: 'Café', votes: 2 },
        { label: 'Thé', votes: 0 },
        { label: 'Chocolat', votes: 3 },
      ],
    })
    expect(rows).toEqual([
      { key: '0', label: 'Café', correct: false, shape: 'triangle', count: 2 },
      { key: '1', label: 'Thé', correct: false, shape: 'diamond', count: 0 },
      { key: '2', label: 'Chocolat', correct: false, shape: 'circle', count: 3 },
    ])
  })

  it('buildDistributionRows ne produit aucune ligne pour un sondage (la répartition vient de poll)', () => {
    expect(buildDistributionRows('poll', null, {})).toEqual([])
  })
})
