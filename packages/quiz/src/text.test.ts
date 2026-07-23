import { describe, expect, it } from 'vitest'
import { normalizeText } from './text.js'

/**
 * `normalizeText` est exportée précisément pour que le front (`PlayerLive.tsx`,
 * `realtime/distribution.ts`) n'ait jamais à recopier à la main la règle de repli
 * accents/casse du moteur de scoring — voir le commentaire au-dessus de la fonction
 * dans `text.ts` pour l'historique du bug évité (`\p{Diacritic}` sur-supprimait).
 */
describe('normalizeText', () => {
  it('replie les marques diacritiques combinantes NFD (accents accolés à une lettre)', () => {
    expect(normalizeText('Café', false)).toBe('cafe')
    expect(normalizeText('Reykjavík', false)).toBe('reykjavik')
  })

  it('respecte caseSensitive', () => {
    expect(normalizeText('Café', true)).toBe('Cafe')
    expect(normalizeText('CAFE', false)).toBe('cafe')
  })

  it('trim les espaces de bord', () => {
    expect(normalizeText('  cafe  ', false)).toBe('cafe')
  })

  // Régression : l'ancienne implémentation locale du front utilisait
  // `value.normalize('NFD').replace(/\p{Diacritic}/gu, '')`. `\p{Diacritic}` matche aussi des
  // caractères D'ESPACEMENT porteurs du trait Unicode Diacritic=Yes (accents autonomes, ex.
  // U+00B4 ACUTE ACCENT) — pas seulement les marques combinantes U+0300–U+036F réellement
  // laissées par normalize('NFD') après une lettre accentuée. `normalizeText` (comme le moteur de
  // scoring serveur) ne doit PAS le supprimer : le verdict client doit toujours pouvoir être
  // reproduit par le serveur, jamais l'inverse.
  it('ne supprime PAS un accent isolé (caractère d’espacement), contrairement à \\p{Diacritic}', () => {
    const withSpacingAccent = 'a´b' // ACUTE ACCENT autonome, pas combiné à une lettre
    expect(normalizeText(withSpacingAccent, false)).toBe('a´b')
    // Documente la divergence évitée : la regex \p{Diacritic} supprimerait ce caractère.
    expect(withSpacingAccent.normalize('NFD').replace(/\p{Diacritic}/gu, '')).toBe('ab')
  })
})
