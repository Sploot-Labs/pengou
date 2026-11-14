import { describe, expect, it } from 'vitest'
import { interpolate, isLang, matchLang, placeholders, pluralCategory, translate } from './i18n'

describe('matchLang', () => {
  it("respecte les pondérations et l'ordre", () => {
    expect(matchLang('es-ES,es;q=0.9,en;q=0.8')).toBe('es')
    expect(matchLang('de-DE,de;q=0.9')).toBe('fr')
    expect(matchLang('de;q=1, en;q=0.5')).toBe('en')
    expect(matchLang('en;q=0.2, es;q=0.8')).toBe('es')
    expect(matchLang('EN-us')).toBe('en')
    expect(matchLang('*')).toBe('fr')
    expect(matchLang(['de-AT', 'pt-BR', 'en-US'])).toBe('en')
  })

  it('retombe sur le français', () => {
    expect(matchLang(undefined)).toBe('fr')
    expect(matchLang(null)).toBe('fr')
    expect(matchLang([])).toBe('fr')
    expect(matchLang('en;q=0')).toBe('fr')
  })
})

describe('interpolate et translate', () => {
  it('remplace les marqueurs connus et garde les inconnus', () => {
    expect(interpolate('{n} joueurs dans {lieu}', { n: 3, lieu: 'la salle' })).toBe('3 joueurs dans la salle')
    expect(interpolate('Bonjour {inconnu}')).toBe('Bonjour {inconnu}')
  })

  it('traduit avec repli sur la clé française', () => {
    const cat = { en: { 'Bonjour {nom}': 'Hello {nom}' }, es: {} }
    expect(translate(cat, 'fr', 'Bonjour {nom}', { nom: 'Ana' })).toBe('Bonjour Ana')
    expect(translate(cat, 'en', 'Bonjour {nom}', { nom: 'Ana' })).toBe('Hello Ana')
    expect(translate(cat, 'es', 'Bonjour {nom}', { nom: 'Ana' })).toBe('Bonjour Ana')
  })

  it("ignore les propriétés héritées d'Object.prototype", () => {
    const cat = { en: { Bonjour: 'Hello' }, es: {} }
    expect(translate(cat, 'en', 'constructor')).toBe('constructor')
    expect(translate(cat, 'es', 'toString')).toBe('toString')
    expect(translate(cat, 'en', '__proto__')).toBe('__proto__')
  })
})

describe('pluralCategory, placeholders, isLang', () => {
  it('donne la catégorie de pluriel', () => {
    expect(pluralCategory('fr', 0)).toBe('one')
    expect(pluralCategory('en', 0)).toBe('other')
    expect(pluralCategory('es', 0)).toBe('other')
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('es', 1000000)).toBe('other')
  })

  it('liste les marqueurs triés sans doublon', () => {
    expect(placeholders('{b} et {a} puis {b}')).toEqual(['a', 'b'])
  })

  it('reconnaît les langues prises en charge', () => {
    expect(isLang('de')).toBe(false)
    expect(isLang('es')).toBe(true)
  })
})
