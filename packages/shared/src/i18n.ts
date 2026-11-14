/** Noyau de traduction partagé : langues, détection, interpolation, pluriel. */

export const LANGS = ['fr', 'en', 'es'] as const
export type Lang = (typeof LANGS)[number]
export const DEFAULT_LANG: Lang = 'fr'
export const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en', es: 'es' }
export const LANG_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English', es: 'Español' }
export type Catalog = Readonly<Record<string, string>>
export type Params = Readonly<Record<string, string | number>>

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

/** Sous-étiquette principale en minuscules (« EN-us » donne « en »). */
function primaryTag(tag: string): string {
  return (tag.trim().toLowerCase().split('-')[0] ?? '').trim()
}

/**
 * Chaîne : en-tête Accept-Language (pondérations q respectées, `*` ignoré).
 * Tableau : navigator.languages, dans l'ordre. Repli sur le français.
 */
export function matchLang(prefs: string | readonly string[] | null | undefined): Lang {
  if (prefs == null) return DEFAULT_LANG
  let ordered: string[]
  if (typeof prefs === 'string') {
    const entries: { tag: string; q: number; index: number }[] = []
    prefs.split(',').forEach((part, index) => {
      const [tag = '', ...rest] = part.split(';')
      let q = 1
      for (const param of rest) {
        const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param)
        if (m) q = Number(m[1])
      }
      if (tag.trim() && Number.isFinite(q) && q > 0) entries.push({ tag, q, index })
    })
    entries.sort((a, b) => b.q - a.q || a.index - b.index)
    ordered = entries.map((e) => e.tag)
  } else {
    ordered = [...prefs]
  }
  for (const tag of ordered) {
    const primary = primaryTag(tag)
    if (isLang(primary)) return primary
  }
  return DEFAULT_LANG
}

/** Remplace les marqueurs {nom} connus ; un marqueur sans valeur reste tel quel. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  )
}

/** fr : la clé interpolée. en, es : l'entrée du catalogue interpolée, ou la clé française si elle manque. */
export function translate(catalogs: { en: Catalog; es: Catalog }, lang: Lang, key: string, params?: Params): string {
  if (lang === 'fr') return interpolate(key, params)
  // Propriétés propres seulement : une clé comme « constructor » ne doit pas lire Object.prototype.
  const catalog = catalogs[lang]
  const entry = Object.hasOwn(catalog, key) ? catalog[key] : undefined
  return interpolate(entry ?? key, params)
}

/** Une instance de Intl.PluralRules par langue, créée au premier besoin. */
const pluralRules = new Map<Lang, Intl.PluralRules>()

/** Intl.PluralRules ; toute catégorie autre que 'one' devient 'other'. */
export function pluralCategory(lang: Lang, count: number): 'one' | 'other' {
  let rules = pluralRules.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang])
    pluralRules.set(lang, rules)
  }
  return rules.select(count) === 'one' ? 'one' : 'other'
}

/** Noms des marqueurs {nom} d'un texte, triés et sans doublon. */
export function placeholders(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1] as string)
  return [...names].sort()
}
