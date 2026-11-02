import { describe, expect, it } from 'vitest'
import {
  type CloudWordInput,
  type Measure,
  type PlacedWord,
  STAGE_H,
  STAGE_W,
  badgePosition,
  hashKey,
  layoutCloud,
  litScales,
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
    const base = wordsOf(8, (i) => 1 + ((i * 7) % 11))
    const a = layoutCloud(base, { measure })
    const previous = new Map(a.placed.map((p) => [p.key, { x: p.x, y: p.y }]))
    const next = base.map((w) => (w.key === a.placed[0]?.key ? { ...w, count: w.count + 1 } : w))
    const b = layoutCloud(next, { measure, previous })
    expectNoOverlap(b.placed)
    // Seule la traîne change : aucun mot ne bouge.
    expect(b.placed.length).toBe(a.placed.length)
    for (const p of b.placed) expect({ x: p.x, y: p.y }).toEqual(previous.get(p.key))
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

  it('tient cent mots à une occurrence en moins de 200 ms sans chevauchement', () => {
    const words = wordsOf(100, () => 1).map((w, i) => ({ ...w, text: `mot-${String(i).padStart(4, 'x')}` }))
    // Appel d'échauffement : la compilation JIT ne doit pas fausser la mesure.
    layoutCloud(words, { measure })
    const t0 = performance.now()
    const { placed } = layoutCloud(words, { measure })
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(200)
    expect(placed.length).toBeGreaterThanOrEqual(90)
    expectNoOverlap(placed)
    expectInside(placed)
  })

  it('garde vertical et placé un long mot vertical du top 4 parmi beaucoup de mots longs', () => {
    let k = 'a'
    for (let i = 0; hashKey(k) % 10 >= 3; i++) k = `v${i}`
    const words = [
      { key: k, text: 'motvraimentlongetvertical', count: 200 },
      ...Array.from({ length: 99 }, (_, i) => ({ key: `long${i}`, text: `motvraimentlong${i}`, count: 100 - i })),
    ]
    const { placed, hidden } = layoutCloud(words, { measure })
    const w = placed.find((p) => p.key === k)
    expect(hidden).not.toContain(k)
    expect(w?.vertical).toBe(true)
    expect(w?.boxH).toBeLessThanOrEqual(700)
  })

  it("garde la même orientation d'une disposition à l'autre, même très chargée", () => {
    const few = wordsOf(10, (i) => 10 - i)
    const many = wordsOf(100, (i) => 100 - i)
    const a = layoutCloud(few, { measure }).placed
    const b = layoutCloud(many, { measure }).placed
    for (const p of [...a, ...b]) expect(p.vertical).toBe(hashKey(p.key) % 10 < 3)
  })
})

function word(key: string, x: number, y: number, boxW: number, boxH: number): PlacedWord {
  return {
    key,
    text: key,
    count: 1,
    x,
    y,
    boxW,
    boxH,
    fontSize: 60,
    vertical: false,
    colorIndex: 0,
    rank: 1,
    small: false,
  }
}

type Rect = { x: number; y: number; w: number; h: number }

/** Boîte d'un mot agrandi autour de son centre. */
function scaled(w: PlacedWord, s: number): Rect {
  return { x: w.x, y: w.y, w: w.boxW * s, h: w.boxH * s }
}

function intersects(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2
}

describe('litScales', () => {
  it('donne 1,1 à un mot allumé isolé', () => {
    const a = word('a', 800, 400, 200, 80)
    const far = word('far', 200, 150, 100, 50)
    expect(litScales([a, far], ['a']).get('a')).toBeCloseTo(1.1, 6)
  })

  it('réduit deux voisins allumés espacés de 7 px pour ne pas se chevaucher', () => {
    const a = word('a', 500, 400, 200, 80)
    const b = word('b', 500 + 200 + 7, 400, 200, 80)
    const scales = litScales([a, b], ['a', 'b'])
    const sa = scales.get('a') ?? 0
    const sb = scales.get('b') ?? 0
    expect(sa).toBeLessThan(1.1)
    expect(sb).toBeLessThan(1.1)
    expect(sa).toBeGreaterThanOrEqual(1)
    expect(intersects(scaled(a, sa), scaled(b, sb))).toBe(false)
  })

  it("tient compte d'un voisin éteint, qui garde sa taille", () => {
    const a = word('a', 500, 400, 200, 80)
    const b = word('b', 707, 400, 200, 80)
    const sa = litScales([a, b], ['a']).get('a') ?? 0
    expect(sa).toBeLessThan(1.1)
    expect(intersects(scaled(a, sa), scaled(b, 1))).toBe(false)
  })

  it('garde le mot agrandi dans la scène', () => {
    const a = word('a', STAGE_W - 24 - 100, 400, 200, 80)
    const sa = litScales([a], ['a']).get('a') ?? 0
    expect(a.x + (a.boxW * sa) / 2).toBeLessThanOrEqual(STAGE_W)
  })

  it("n'attribue pas d'échelle aux mots éteints", () => {
    const a = word('a', 800, 400, 200, 80)
    expect(litScales([a], []).has('a')).toBe(false)
  })
})

describe('badgePosition', () => {
  const badge = { w: 170, h: 56 }
  const box = (p: { x: number; y: number }): Rect => ({
    x: p.x + badge.w / 2,
    y: p.y + badge.h / 2,
    w: badge.w,
    h: badge.h,
  })

  it('place la pastille en haut à droite quand la place est libre', () => {
    const w = word('a', 800, 400, 200, 80)
    const p = badgePosition(w, [], badge)
    expect(p.y + badge.h).toBeLessThanOrEqual(w.y - w.boxH / 2)
    expect(p.x + badge.w).toBeGreaterThan(w.x + w.boxW / 2)
  })

  it("garde la pastille entière dans la scène pour un mot près du coin haut droit", () => {
    const w = word('a', 1500, 60, 160, 60)
    const p = badgePosition(w, [], badge)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.x + badge.w).toBeLessThanOrEqual(STAGE_W)
    expect(p.y + badge.h).toBeLessThanOrEqual(STAGE_H)
    expect(intersects(box(p), scaled(w, 1))).toBe(false)
  })

  it('choisit un autre coin quand un mot allumé est juste au-dessus', () => {
    const w = word('a', 800, 400, 200, 80)
    const above = word('b', 800, 320, 200, 60)
    const obstacle = scaled(above, 1)
    const p = badgePosition(w, [obstacle], badge)
    expect(intersects(box(p), obstacle)).toBe(false)
    expect(p.y).toBeGreaterThanOrEqual(w.y + w.boxH / 2)
  })

  it("évite une pastille déjà posée", () => {
    const w = word('a', 800, 400, 200, 80)
    const first = badgePosition(w, [], badge)
    const second = badgePosition(w, [box(first)], badge)
    expect(intersects(box(first), box(second))).toBe(false)
  })

  it("se place sur le côté du mot quand les quatre coins sont pris", () => {
    // Cas relevé sur le grand écran : mot allumé coincé entre un allumé au-dessus et un au-dessous.
    const w = word('a', 800, 400, 400, 120)
    const obstacles: Rect[] = [
      { x: 720, y: 280, w: 550, h: 115 },
      { x: 910, y: 535, w: 640, h: 106 },
    ]
    const p = badgePosition(w, obstacles, badge)
    for (const o of obstacles) expect(intersects(box(p), o)).toBe(false)
    expect(intersects(box(p), scaled(w, 1))).toBe(false)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x + badge.w).toBeLessThanOrEqual(STAGE_W)
  })

  it('se replie en haut à droite, ramenée dans la scène, quand aucun coin ne convient', () => {
    const w = word('a', 1500, 60, 160, 60)
    const wall: Rect = { x: 800, y: 400, w: 1600, h: 800 }
    const p = badgePosition(w, [wall], badge)
    expect(p.x + badge.w).toBeLessThanOrEqual(STAGE_W)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })
})
