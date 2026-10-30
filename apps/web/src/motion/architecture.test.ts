import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const MOTION_DIR = join(SRC, 'motion')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

// `+ sep` : un simple `startsWith(MOTION_DIR)` exclurait aussi à tort un futur
// dossier frère comme `motion-legacy/` (préfixe de chaîne identique sans le
// séparateur). Ce fichier de test lui-même vit dans motion/ et reste bien
// exclu (son propre chemin commence par `MOTION_DIR + sep`).
const filesOutsideMotion = () => walk(SRC).filter((p) => !p.startsWith(MOTION_DIR + sep))

describe('garde d\'architecture', () => {
  it("aucun fichier hors motion/ n'importe framer-motion", () => {
    const offenders = filesOutsideMotion().filter((p) =>
      /from ['"]framer-motion['"]/.test(readFileSync(p, 'utf8')),
    )
    expect(offenders, `framer-motion importé hors de motion/: ${offenders.join(', ')}`).toEqual([])
  })

  // README.md (motion/) promet que le canvas ET la Web Audio API sont, eux
  // aussi, confinés à motion/ — pas seulement framer-motion.
  // Exception : media/downscale.ts redessine une image envoyée sur un canvas hors écran pour la
  // réduire. Ce n'est pas de l'animation ; c'est le seul usage autorisé hors de motion/.
  const CANVAS_ALLOWED = join(SRC, 'media', 'downscale.ts')
  it("aucun fichier hors motion/ n'utilise l'API canvas (.getContext)", () => {
    const offenders = filesOutsideMotion()
      .filter((p) => p !== CANVAS_ALLOWED)
      .filter((p) => /\.getContext\(/.test(readFileSync(p, 'utf8')))
    expect(offenders, `.getContext( utilisé hors de motion/: ${offenders.join(', ')}`).toEqual([])
  })

  it("aucun fichier hors motion/ n'utilise la Web Audio API", () => {
    const offenders = filesOutsideMotion().filter((p) =>
      /new AudioContext|webkitAudioContext|new Audio\(/.test(readFileSync(p, 'utf8')),
    )
    expect(
      offenders,
      `AudioContext/webkitAudioContext/new Audio( utilisé hors de motion/: ${offenders.join(', ')}`,
    ).toEqual([])
  })
})
