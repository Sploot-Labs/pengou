/** Helpers de validation d'entrée partagés par les routes (bornes de longueur, sûreté des URLs
 * de média/couverture). Centralisés ici pour éviter la dérive entre routes (P2). */

export const LIMITS = {
  title: 200,
  description: 2000,
  prompt: 500,
  media: 2048,
  cover: 2048,
  nickname: 32,
} as const

/** Vrai si `value` est une chaîne dépassant `max` caractères. */
export function tooLong(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > max
}

/**
 * Sûreté d'une URL de média / couverture (anti-XSS latent + abus stockage). Approche
 * ALLOWLIST plutôt que denylist : au lieu d'énumérer les schémas dangereux (javascript:,
 * data:, vbscript:, …), on n'autorise QUE des références sûres :
 *   - une référence relative (pas de schéma « xxx: » avant un « / ») — ex. `clip.mp4`, `/media/x.webm`
 *   - une URL http(s)
 * Tout autre schéma (`data:`, `javascript:`, `foo:`, …) est refusé. Refuse aussi les caractères
 * de contrôle (injection d'en-tête / bruit) et borne la longueur.
 */
export function isSafeMedia(value: string, max: number = LIMITS.media): boolean {
  if (value.length > max) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false // caractères de contrôle
  }
  // Un schéma d'URL est une suite « lettre [lettre|chiffre|+|-|.]* : ». S'il y en a un, il doit
  // être http/https. Sinon (référence relative, pas de « : » de schéma), on accepte.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value.trimStart())
  if (scheme && scheme[1].toLowerCase() !== 'http' && scheme[1].toLowerCase() !== 'https') {
    return false
  }
  return true
}
