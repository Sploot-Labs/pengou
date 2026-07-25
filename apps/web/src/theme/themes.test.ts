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

  it('définit les rôles réponse, podium et focus dans les deux blocs (source unique)', () => {
    const roles = [
      '--ans-triangle', '--ans-diamond', '--ans-circle', '--ans-square',
      '--gold', '--silver', '--bronze', '--focus',
    ]
    for (const selector of ["[data-theme='app']", "[data-theme='scene']"]) {
      const start = themesCss.indexOf(selector)
      expect(start, `bloc ${selector} introuvable`).toBeGreaterThanOrEqual(0)
      const block = themesCss.slice(start, themesCss.indexOf('}', start))
      for (const role of roles) {
        expect(block, `${role} manquant dans ${selector}`).toContain(role)
      }
    }
  })

  it('ne réintroduit pas la palette Kahoot (rose/violet)', () => {
    expect(themesCss.toLowerCase()).not.toContain('#ff3d7f')
    expect(themesCss.toLowerCase()).not.toContain('#7a5cff')
  })
})
