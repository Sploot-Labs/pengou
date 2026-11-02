import { describe, expect, it } from 'vitest'
import {
  type CloudWordInput,
  type Measure,
  type PlacedWord,
  STAGE_H,
  STAGE_W,
  hashKey,
  layoutCloud,
  sortWords,
} from './layout.js'

const measure: Measure = (t) => ({ w: t.length * 55, h: 100 })

function overlaps(a: PlacedWord, b: PlacedWord): boolean {
  return Math.abs(a.x - b.x) < (a.boxW + b.boxW) / 2 && Math.abs(a.y - b.y) < (a.boxH + b.boxH) / 2
}

function expectNoOverlap(placed: PlacedWord[]): void {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlaps(placed[i] as PlacedWord, placed[j] as PlacedWord)).toBe(false)
    }
  }
}

function expectInside(placed: PlacedWord[]): void {
  for (const p of placed) {
    expect(p.x - p.boxW / 2).toBeGreaterThanOrEqual(0)
    expect(p.x + p.boxW / 2).toBeLessThanOrEqual(STAGE_W)
    expect(p.y - p.boxH / 2).toBeGreaterThanOrEqual(0)
    expect(p.y + p.boxH / 2).toBeLessThanOrEqual(STAGE_H)
  }
}

function wordsOf(n: number, countOf: (i: number) => number): CloudWordInput[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `mot${i}`,
    text: `mot${i}`,
    count: countOf(i),
  }))
}

describe('sortWords', () => {
  it('trie par occurrences décroissantes puis ordre alphabétique fr', () => {
    expect(
      sortWords([
        { key: 'b', text: 'bé', count: 2 },
        { key: 'a', text: 'âne', count: 2 },
        { key: 'c', text: 'c', count: 5 },
      ]).map((w) => w.key),
    ).toEqual(['c', 'a', 'b'])
  })
})

describe('layoutCloud', () => {
  it('place le premier mot au centre, horizontal, avec le rang 1', () => {
    const { placed } = layoutCloud([{ key: 'equipe', text: 'équipe', count: 5 }], {
      measure,
      firstKey: 'equipe',
    })
    expect(placed[0]).toMatchObject({ x: 800, y: 400, vertical: false, rank: 1 })
  })

  it('ne superpose aucun mot', () => {
    const { placed } = layoutCloud(
      wordsOf(40, (i) => 1 + ((i * 7) % 13)),
      { measure },
    )
    expect(placed.length).toBeGreaterThan(10)
    expectNoOverlap(placed)
    expectInside(placed)
  })

  it('dérive couleur et orientation de la clé, de façon stable', () => {
    const a = layoutCloud(
      wordsOf(12, (i) => 12 - i),
      { measure, firstKey: 'mot0' },
    ).placed
    const b = layoutCloud(
      wordsOf(12, (i) => 1 + ((i * 5) % 7)),
      { measure, firstKey: 'mot0' },
    ).placed
    for (const p of a) {
      const q = b.find((w) => w.key === p.key)
      if (!q) continue
      expect(q.colorIndex).toBe(p.colorIndex)
      expect(q.vertical).toBe(p.vertical)
      expect(p.colorIndex).toBe(hashKey(p.key) % 7)
      expect(p.vertical).toBe(p.key !== 'mot0' && hashKey(p.key) % 10 < 3)
    }
  })

  it("ne force pas à l'horizontale un mot vertical qui prend la tête", () => {
    let k = 'a'
    for (let i = 0; hashKey(k) % 10 >= 3; i++) k = `m${i}`
    const { placed } = layoutCloud(
      [
        { key: k, text: k, count: 9 },
        { key: 'zzz', text: 'zzz', count: 2 },
      ],
      { measure, firstKey: 'zzz' },
    )
    expect(placed.find((w) => w.key === k)?.vertical).toBe(true)
  })

  it('fait croître la taille avec la racine du rapport au premier', () => {
    const { placed } = layoutCloud(
      [
        { key: 'a', text: 'a', count: 16 },
        { key: 'b', text: 'b', count: 4 },
      ],
      { measure },
    )
    expect(placed.find((w) => w.key === 'a')?.fontSize).toBeCloseTo(156, 2)
    expect(placed.find((w) => w.key === 'b')?.fontSize).toBeCloseTo(34 + 122 * 0.5, 2)
  })

  it('marque la traîne atténuée sous un quart du premier quand il dépasse 3', () => {
    const smallOf = (c1: number, c2: number) =>
      layoutCloud(
        [
          { key: 'a', text: 'a', count: c1 },
          { key: 'b', text: 'b', count: c2 },
        ],
        { measure },
      ).placed.find((w) => w.key === 'b')?.small
    expect(smallOf(8, 1)).toBe(true)
    expect(smallOf(3, 1)).toBe(false)
  })

  it('réduit un mot trop long pour tenir en largeur', () => {
    const { placed } = layoutCloud([{ key: 'x', text: 'anticonstitutionnellement', count: 9 }], {
      measure,
      firstKey: 'x',
    })
    expect(placed[0]?.boxW).toBeLessThanOrEqual(1250)
  })

  it('garde la position précédente quand elle est encore libre', () => {
    const base = wordsOf(30, (i) => 1 + ((i * 7) % 11))
    const a = layoutCloud(base, { measure })
    const previous = new Map(a.placed.map((p) => [p.key, { x: p.x, y: p.y }]))
    const next = base.map((w, i) => (i === 29 ? { ...w, count: w.count + 1 } : w))
    const b = layoutCloud(next, { measure, previous })
    expectNoOverlap(b.placed)
    // Les mots dont la taille n'a pas changé gardent exactement leur place.
    const same = b.placed.filter((p) => a.placed.find((w) => w.key === p.key)?.fontSize === p.fontSize)
    expect(same.length).toBeGreaterThan(0)
    for (const p of same) {
      expect({ x: p.x, y: p.y }).toEqual(previous.get(p.key))
    }
  })

  it('place toujours le top 4, quitte à le réduire', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      key: `long${i}`,
      text: `motvraimentlong${i}`,
      count: 100 - i,
    }))
    const { placed, hidden } = layoutCloud(words, { measure })
    const keys = placed.map((p) => p.key)
    for (let i = 0; i < 4; i++) {
      expect(keys).toContain(`long${i}`)
      expect(hidden).not.toContain(`long${i}`)
    }
    expectNoOverlap(placed)
  })

  it('tient cent mots à une occurrence en moins de 50 ms sans chevauchement', () => {
    const words = wordsOf(100, () => 1)
    const t0 = performance.now()
    const { placed } = layoutCloud(words, { measure })
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(50)
    expectNoOverlap(placed)
    expectInside(placed)
  })
})
