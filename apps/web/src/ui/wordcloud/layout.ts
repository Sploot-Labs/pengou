/**
 * Placement pur du nuage de mots du grand écran : spirale elliptique autour du centre,
 * sans collision, avec conservation des positions d'une mise à jour à l'autre.
 * Aucune dépendance au DOM : la mesure du texte est injectée.
 */

export const STAGE_W = 1600
export const STAGE_H = 800
export const PALETTE_SIZE = 7

const MARGIN = 24
const PAD = 7
const MAX_WORD_W = 1250
/** Longueur maximale d'un mot vertical : sa boîte doit tenir dans la hauteur utile de la scène. */
const MAX_VERTICAL_LENGTH = 700
/** Part de l'aire utile que les boîtes nominales peuvent occuper avant réduction globale. */
const DENSITY_FILL = 0.45
const MIN_FONT_SIZE = 28
const MAX_STEPS = 4000
const MAX_RADIUS = 1000
const TOP_PROTECTED = 4
const MAX_SHRINKS = 5

export interface CloudWordInput {
  key: string
  text: string
  count: number
}

/**
 * Taille de police à laquelle les mots sont mesurés et rendus. La taille affichée passe par une
 * mise à l'échelle (`fontSize / BASE_FONT_SIZE`) : changer la taille d'un mot ne relance ni la
 * mise en page ni la mise en forme du texte.
 */
export const BASE_FONT_SIZE = 100

/** Dimensions d'un mot mesuré à `BASE_FONT_SIZE` px de police, sans rotation. */
export type Measure = (text: string) => { w: number; h: number }

export interface PlacedWord extends CloudWordInput {
  x: number
  y: number // centre, en px de scène
  boxW: number
  boxH: number // boîte englobante après rotation
  fontSize: number
  vertical: boolean
  colorIndex: number // 0..PALETTE_SIZE-1
  rank: number // 1 = plus cité
  small: boolean // traîne atténuée
}

export interface LayoutOptions {
  measure: Measure
  previous?: ReadonlyMap<string, { x: number; y: number }>
  /** Premier mot affiché de la question : forcé horizontal. */
  firstKey?: string
}

export function hashKey(key: string): number {
  let h = 7
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function sortWords<T extends CloudWordInput>(words: readonly T[]): T[] {
  return [...words].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'fr'))
}

/** Boîte repérée par son centre, en px de scène. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function layoutCloud(
  words: readonly CloudWordInput[],
  opts: LayoutOptions,
): { placed: PlacedWord[]; hidden: string[] } {
  const sorted = sortWords(words)
  const placed: PlacedWord[] = []
  const hidden: string[] = []
  const first = sorted[0]
  if (!first) return { placed, hidden }
  const max = first.count
  const boxes: Box[] = []

  // Tailles nominales (échelle de fréquence, plafonds de largeur et de longueur verticale).
  const nominal = sorted.map((word) => {
    const hash = hashKey(word.key)
    const ratio = word.count / max
    const m = opts.measure(word.text)
    const vertical = word.key !== opts.firstKey && hash % 10 < 3
    let size = 34 + 122 * Math.sqrt(ratio)
    let w = (m.w * size) / BASE_FONT_SIZE
    let h = (m.h * size) / BASE_FONT_SIZE
    const cap = vertical ? MAX_VERTICAL_LENGTH : MAX_WORD_W
    if (w > cap) {
      const f = cap / w
      size *= f
      w *= f
      h *= f
    }
    return { hash, ratio, vertical, size, w, h }
  })
  // Facteur de densité global : une grande salle (beaucoup de mots) réduit toutes les tailles.
  const sumArea = nominal.reduce((acc, n) => acc + n.w * n.h, 0)
  const usableArea = (STAGE_W - 2 * MARGIN) * (STAGE_H - 2 * MARGIN)
  const density = Math.min(1, Math.sqrt((DENSITY_FILL * usableArea) / sumArea))

  sorted.forEach((word, i) => {
    const {
      hash,
      ratio,
      vertical,
      size: nominalSize,
      w: nominalW,
      h: nominalH,
    } = nominal[i] as (typeof nominal)[number]
    const phase = (hash % 628) / 100
    const prev = opts.previous?.get(word.key)
    const scaled = Math.max(MIN_FONT_SIZE, nominalSize * density)
    const base = scaled / nominalSize

    // Le top 4 est toujours placé : réductions successives de 15 % si besoin.
    const tries = i < TOP_PROTECTED ? MAX_SHRINKS + 1 : 1
    for (let attempt = 0; attempt < tries; attempt++) {
      const shrink = 0.85 ** attempt
      const size = nominalSize * base * shrink
      const w = nominalW * base * shrink
      const h = nominalH * base * shrink
      const bw = vertical ? h : w
      const bh = vertical ? w : h
      const fits = (x: number, y: number): boolean =>
        x - bw / 2 >= MARGIN &&
        x + bw / 2 <= STAGE_W - MARGIN &&
        y - bh / 2 >= MARGIN &&
        y + bh / 2 <= STAGE_H - MARGIN &&
        !boxes.some((b) => Math.abs(b.x - x) < (b.w + bw) / 2 + PAD && Math.abs(b.y - y) < (b.h + bh) / 2 + PAD)

      let pos: { x: number; y: number } | null = null
      if (prev && fits(prev.x, prev.y)) pos = { x: prev.x, y: prev.y }
      else {
        let t = 0
        for (let n = 0; n < MAX_STEPS; n++) {
          const r = 6 * t
          if (r > MAX_RADIUS) break
          const x = STAGE_W / 2 + 1.75 * r * Math.cos(t + phase)
          const y = STAGE_H / 2 + r * Math.sin(t + phase)
          if (fits(x, y)) {
            pos = { x, y }
            break
          }
          t += Math.min(0.5, 9 / (r + 1))
        }
      }
      if (!pos) continue

      boxes.push({ x: pos.x, y: pos.y, w: bw, h: bh })
      placed.push({
        ...word,
        x: pos.x,
        y: pos.y,
        boxW: bw,
        boxH: bh,
        fontSize: size,
        vertical,
        colorIndex: hash % PALETTE_SIZE,
        rank: i + 1,
        small: ratio < 0.25 && max > 3,
      })
      return
    }
    hidden.push(word.key)
  })

  return { placed, hidden }
}

/** Agrandissement visé d'un mot allumé à la révélation. */
export const LIT_SCALE = 1.1

/**
 * Échelle de chaque mot allumé : la plus grande, au plus `LIT_SCALE`, telle que sa boîte agrandie
 * autour de son centre ne touche aucune autre boîte (allumée et agrandie, ou éteinte à taille 1)
 * et reste dans la scène. Deux allumés voisins sont bornés par une même échelle commune, ce qui
 * garantit l'absence de chevauchement quelle que soit l'échelle finale de chacun.
 */
export function litScales(placed: readonly PlacedWord[], litKeys: readonly string[]): Map<string, number> {
  const lit = new Set(litKeys)
  const scales = new Map<string, number>()
  for (const w of placed) {
    if (!lit.has(w.key)) continue
    let s = Math.min(
      LIT_SCALE,
      (2 * Math.min(w.x, STAGE_W - w.x)) / w.boxW,
      (2 * Math.min(w.y, STAGE_H - w.y)) / w.boxH,
    )
    for (const o of placed) {
      if (o === w) continue
      const dx = Math.abs(o.x - w.x)
      const dy = Math.abs(o.y - w.y)
      // Séparé dès qu'un des deux axes l'est : on garde l'axe le plus favorable.
      const bound = lit.has(o.key)
        ? Math.max((2 * dx) / (w.boxW + o.boxW), (2 * dy) / (w.boxH + o.boxH))
        : Math.max((2 * dx - o.boxW) / w.boxW, (2 * dy - o.boxH) / w.boxH)
      s = Math.min(s, bound)
    }
    // Jamais de réduction sous la taille d'origine (le placement garantit déjà l'absence de contact).
    scales.set(w.key, Math.max(1, s))
  }
  return scales
}

function boxesIntersect(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2
}

/** Part de la pastille qui déborde sur le mot, côté du coin choisi. */
const BADGE_OVERLAP = 0.3

/**
 * Coin supérieur gauche de la pastille d'un mot allumé, en px de scène. Essaie dans l'ordre les
 * coins haut droit, haut gauche, bas droit, bas gauche (pastille juste au-dessus ou au-dessous du
 * mot), puis les côtés du mot, et retient la première place qui tient dans la scène sans toucher
 * d'obstacle (autres mots allumés, pastilles déjà posées). À défaut : haut droit, ramené dans la scène.
 */
export function badgePosition(
  word: PlacedWord,
  obstacles: readonly Box[],
  badge: { w: number; h: number } = { w: 170, h: 56 },
): { x: number; y: number } {
  const left = word.x - word.boxW / 2
  const right = word.x + word.boxW / 2
  const top = word.y - word.boxH / 2
  const bottom = word.y + word.boxH / 2
  const onRight = right - BADGE_OVERLAP * badge.w
  const onLeft = left - (1 - BADGE_OVERLAP) * badge.w
  const corners = [
    { x: onRight, y: top - badge.h },
    { x: onLeft, y: top - badge.h },
    { x: onRight, y: bottom },
    { x: onLeft, y: bottom },
    // Au cœur d'un nuage dense, les quatre coins peuvent être pris par d'autres mots allumés :
    // la pastille se pose alors sur le côté du mot, en haut puis en bas, à droite puis à gauche.
    { x: right, y: top },
    { x: left - badge.w, y: top },
    { x: right, y: bottom - badge.h },
    { x: left - badge.w, y: bottom - badge.h },
  ]
  for (const c of corners) {
    if (c.x < 0 || c.y < 0 || c.x + badge.w > STAGE_W || c.y + badge.h > STAGE_H) continue
    const box = { x: c.x + badge.w / 2, y: c.y + badge.h / 2, w: badge.w, h: badge.h }
    if (!obstacles.some((o) => boxesIntersect(o, box))) return c
  }
  const first = corners[0] as { x: number; y: number }
  return {
    x: Math.min(Math.max(0, first.x), STAGE_W - badge.w),
    y: Math.min(Math.max(0, first.y), STAGE_H - badge.h),
  }
}
