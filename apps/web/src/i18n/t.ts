import { LOCALES, pluralCategory, translate, type Params } from '@splootlabs/shared/i18n'
import { catalog, type WebKey } from './catalog'
import { getLang } from './lang'

/** Hors composant : lit la langue courante à l'appel. */
export function t(key: WebKey, params?: Params): string {
  return translate(catalog, getLang(), key, params)
}

/** Choisit `one` ou `other` selon la langue ; `{n}` vaut `count` formaté. */
export function tp(count: number, one: WebKey, other: WebKey, params?: Params): string {
  const key = pluralCategory(getLang(), count) === 'one' ? one : other
  return translate(catalog, getLang(), key, { ...params, n: formatNumber(count) })
}

export function formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(LOCALES[getLang()], options).format(date)
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALES[getLang()], options).format(value)
}

/** Paires [clé, contexte] déclarées dans les catalogues sous la forme `clé#contexte`. */
type ContextPair = WebKey extends infer K ? (K extends `${infer B}#${infer C}` ? [B, C] : never) : never

/**
 * Traduction contextuelle, à la manière de gettext : un même texte français peut avoir deux
 * sens (« Annuler » : renoncer ou défaire). En français, la clé est affichée telle quelle et le
 * contexte ne se voit jamais ; en anglais et en espagnol, l'entrée `clé#contexte` du catalogue
 * donne la traduction, et à défaut celle de la clé seule. Le typage refuse une paire sans entrée.
 */
export function tc<B extends ContextPair[0]>(
  key: B,
  context: Extract<ContextPair, [B, string]>[1],
  params?: Params,
): string {
  const lang = getLang()
  if (lang === 'fr') return translate(catalog, lang, key, params)
  const composed = `${key}#${context}` as WebKey
  return translate(catalog, lang, composed in catalog[lang] ? composed : (key as unknown as WebKey), params)
}
