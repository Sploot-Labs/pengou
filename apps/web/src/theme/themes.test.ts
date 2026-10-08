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

  it("ne réintroduit pas l'ancienne palette rose/violet", () => {
    expect(themesCss.toLowerCase()).not.toContain('#ff3d7f')
    expect(themesCss.toLowerCase()).not.toContain('#7a5cff')
  })

  it('mappe les rôles produit sur les primitives Pingou (palette banquise)', () => {
    expect(themesCss).toContain('--pingou-brand')
    expect(themesCss).toContain('--pingou-cyan')
  })
})

it("tokens.css ne définit plus de primitive couleur de l'ancienne palette", () => {
  const tokensCss = readFileSync(
    fileURLToPath(new URL('../tokens.css', import.meta.url)),
    'utf-8',
  ).toLowerCase()
  expect(tokensCss).not.toContain('#ff3d7f') // ancien rose
  expect(tokensCss).not.toContain('#7a5cff') // ancien violet
  expect(tokensCss).not.toContain('#0e1230') // ancien midnight bleuté
  expect(tokensCss).not.toContain('--brand:')
  expect(tokensCss).not.toContain('--stage:')
})

it("prototype.css ne réintroduit pas l'ancien rose (hex ni rgba)", () => {
  const prototypeCss = readFileSync(
    fileURLToPath(new URL('../prototype.css', import.meta.url)),
    'utf-8',
  ).toLowerCase()
  expect(prototypeCss).not.toContain('#ff3d7f')
  expect(prototypeCss).not.toMatch(/rgba\(\s*255\s*,\s*61\s*,\s*127/)
})

it("la règle de couleur de lien de base ne s'applique qu'aux liens textuels (pas aux liens à classe)", () => {
  const tokensCss = readFileSync(
    fileURLToPath(new URL('../tokens.css', import.meta.url)),
    'utf-8',
  )
  expect(tokensCss).toContain('.prototype-root a:not([class])')
})
