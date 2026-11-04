import { describe, expect, it } from 'vitest'
import { suggestEmailDomain } from './email-suggest.js'

describe('suggestEmailDomain', () => {
  it.each([
    ['camille@gmial.com', 'camille@gmail.com'],
    ['a@hotmial.fr', 'a@hotmail.fr'],
    ['a@gmail.con', 'a@gmail.com'],
    ['Pre.Nom+x@gmal.com', 'Pre.Nom+x@gmail.com'],
  ])('corrige %s', (input, expected) => {
    expect(suggestEmailDomain(input)).toBe(expected)
  })

  it('ne propose rien pour un domaine déjà courant ou lointain', () => {
    expect(suggestEmailDomain('a@orange.fr')).toBeNull()
    expect(suggestEmailDomain('a@exemple-ecole.fr')).toBeNull()
  })

  it('renvoie null sans arobase ou sans domaine', () => {
    expect(suggestEmailDomain('camille')).toBeNull()
    expect(suggestEmailDomain('camille@')).toBeNull()
  })
})
