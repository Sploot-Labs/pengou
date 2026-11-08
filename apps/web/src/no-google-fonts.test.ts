import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Les polices sont auto-hébergées (src/theme/fonts.css) : ni index.html ni le build ne doivent
// faire charger quoi que ce soit depuis Google, sous peine d'envoyer l'adresse IP de chaque
// hôte et de chaque joueur à un tiers.
const GOOGLE_FONTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

describe('aucune référence à Google Fonts', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'pengou-web-build-'))
  afterAll(() => rmSync(outDir, { recursive: true, force: true }))

  it('index.html ne référence ni fonts.googleapis.com ni fonts.gstatic.com', () => {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8')
    expect(html).not.toMatch(GOOGLE_FONTS)
  })

  it('le build de apps/web ne référence aucun domaine Google Fonts et embarque les polices', async () => {
    const { build } = await import('vite')
    await build({ root: webRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } })

    const files = listFiles(outDir)
    const offenders = files
      .filter((file) => /\.(html|css|js|mjs|json|webmanifest|svg|txt)$/.test(file))
      .filter((file) => GOOGLE_FONTS.test(readFileSync(file, 'utf8')))
      .map((file) => relative(outDir, file))
    expect(offenders).toEqual([])

    // Les trois familles sont servies par l'application elle-même.
    const fonts = files.filter((file) => file.endsWith('.woff2')).map((file) => relative(outDir, file))
    expect(fonts.some((f) => f.includes('fredoka'))).toBe(true)
    expect(fonts.some((f) => f.includes('dm-mono'))).toBe(true)
    expect(fonts.some((f) => f.includes('nunito-sans'))).toBe(true)
  }, 180_000)
})
