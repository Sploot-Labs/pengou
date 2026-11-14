import { formatDate } from '../i18n/t'
import { apiGet, apiPost } from './client'

/** Configuration des CGU de l'instance (`GET /api/legal`). `termsVersion` à null : aucune
 * acceptation demandée (instance auto-hébergée sans CGU), l'inscription reste sans case. */
export interface LegalInfo {
  termsVersion: string | null
  termsUrl: string | null
  privacyUrl: string | null
}

/** CGU actives : les trois valeurs sont garanties par la configuration serveur. */
export interface ActiveLegalInfo {
  termsVersion: string
  termsUrl: string
  privacyUrl: string
}

export function isLegalActive(info: LegalInfo): info is ActiveLegalInfo {
  return info.termsVersion !== null && info.termsUrl !== null && info.privacyUrl !== null
}

export function fetchLegal(): Promise<LegalInfo> {
  return apiGet<LegalInfo>('/api/legal')
}

/** Accepte la version affichée. Le serveur horodate lui-même et répond 409 si elle n'est plus la
 * version courante. */
export function acceptTerms(version: string): Promise<{ termsVersion: string; termsAcceptedAt: string }> {
  return apiPost('/api/legal/accept', { version })
}

/** « 2026-10-31 » → « 31 octobre 2026 », « October 31, 2026 » ou « 31 de octubre de 2026 » (date calendaire, sans décalage de fuseau). */
export function formatTermsDate(version: string): string {
  const date = new Date(`${version}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return version
  return formatDate(date, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
