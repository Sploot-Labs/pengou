import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const themesCssPath = fileURLToPath(new URL('./themes.css', import.meta.url))
const themesCss = readFileSync(themesCssPath, 'utf-8')

describe('themes.css', () => {
  it("scope les rôles produit sur l'attribut du wrapper, pas sur :root", () => {
    expect(themesCss).toContain("[data-theme='app']")
    expect(themesCss).toContain("[data-theme='scene']")
    expect(themesCss).toContain("[data-scheme='dark']")
    expect(themesCss).toContain("[data-scheme='light']")
  })

  it('ne réintroduit pas le sélecteur cassé :root[data-…] (ne matche jamais un wrapper imbriqué)', () => {
    expect(themesCss).not.toContain(':root[data-')
  })
})
