import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

describe('garde d\'architecture', () => {
  it("aucun fichier hors motion/ n'importe framer-motion", () => {
    const offenders = walk(SRC)
      .filter((p) => !p.startsWith(MOTION_DIR))
      .filter((p) => /from ['"]framer-motion['"]/.test(readFileSync(p, 'utf8')))
    expect(offenders, `framer-motion importé hors de motion/: ${offenders.join(', ')}`).toEqual([])
  })
})
