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

/** Dimensions d'un mot mesuré à 100 px de police, sans rotation. */
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

interface Box {
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
    let w = (m.w * size) / 100
    let h = (m.h * size) / 100
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
