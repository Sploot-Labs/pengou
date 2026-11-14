import { getLang } from '../i18n/lang'

/**
 * Rang abrégé, accordé à « place » (féminin) en français pour rester neutre vis-à-vis du joueur :
 * 1ʳᵉ, 2ᵉ, 3ᵉ… (« 1ᵉ » n'existe pas). En anglais : 1st, 2nd, 3rd, 4th (règle ordinale d'Intl).
 * En espagnol : 1.º, 2.º, avec « puesto » (masculin) dans les phrases.
 */
export function placeOrdinal(rank: number): string {
  const lang = getLang()
  if (lang === 'en') {
    const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' } as const
    const category = new Intl.PluralRules('en', { type: 'ordinal' }).select(rank)
    return `${rank}${suffix[category as keyof typeof suffix] ?? 'th'}`
  }
  if (lang === 'es') return `${rank}.º`
  return rank === 1 ? '1ʳᵉ' : `${rank}ᵉ`
}
