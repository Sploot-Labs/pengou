import { describe, expect, it } from 'vitest'
import { normalizeSignupSource } from './signup-source'

describe('normalizeSignupSource', () => {
  it.each([
    ['accueil', 'accueil'],
    ['kahoot-gratuit-sans-compte', 'kahoot-gratuit-sans-compte'],
    ['  Etablissements ', 'etablissements'],
    ['page2', 'page2'],
  ])('accepte %j', (raw, expected) => {
    expect(normalizeSignupSource(raw)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    42,
    '',
    '   ',
    '-accueil',
    'accueil-',
    'a--b',
    'é',
    'a b',
    'a/b',
    '<script>',
    'x'.repeat(65),
  ])('ignore %j', (raw) => {
    expect(normalizeSignupSource(raw)).toBeNull()
  })
})
