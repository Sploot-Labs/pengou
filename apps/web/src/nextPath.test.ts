import { describe, expect, it } from 'vitest'
import { nextQuery, safeNextPath } from './nextPath'

describe('safeNextPath', () => {
  it('accepte un chemin relatif avec sa requête', () => {
    expect(safeNextPath('/invitations/abc?v=xyz')).toBe('/invitations/abc?v=xyz')
  })
  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    String.raw`/\evil.example`,
    'invitations/abc',
    '/a\nb',
  ])('refuse %j', (raw) => {
    expect(safeNextPath(raw)).toBeNull()
  })
})

describe('nextQuery', () => {
  it('encode la destination', () => {
    expect(nextQuery('/invitations/abc?v=x y')).toBe('?next=%2Finvitations%2Fabc%3Fv%3Dx%20y')
  })
  it('reste vide sans destination', () => {
    expect(nextQuery(null)).toBe('')
  })
})
