/** Longueur maximale d'une provenance d'inscription. */
export const SIGNUP_SOURCE_MAX = 64

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Provenance d'une inscription (`?from=<slug-de-page>` posé par le site vitrine sur ses liens),
 * normalisée en minuscules. Tout ce qui n'est pas un slug court renvoie null : la valeur est
 * ignorée, jamais une cause de refus d'inscription.
 */
export function normalizeSignupSource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  if (value.length === 0 || value.length > SIGNUP_SOURCE_MAX) return null
  return SLUG.test(value) ? value : null
}
