import { apiPost } from './client'

/** Ce que le serveur rend après « Lancer la démonstration » (`POST /api/demo`). */
export interface DemoStart {
  /** Le quiz d'exemple copié dans l'espace de l'hôte invité. */
  quizId: string
  /** L'espace de l'hôte invité : à poser comme espace actif avant de lancer la partie. */
  tenantId: string
  /** Sa partie déjà vivante (second onglet, retour sur `/demo`), `null` sinon. */
  liveSessionId: string | null
}

export interface DemoStartInput {
  /** La case « J'ai 15 ans ou plus », cochée. */
  ageConfirmed: boolean
  /** Version des conditions d'utilisation affichée et acceptée (instance qui en publie). */
  acceptedTermsVersion?: string
  /** Page du site d'où vient le visiteur (`?from=`), déjà normalisée. */
  from?: string
}

/** Codes de refus de `POST /api/demo` que l'écran traite à part. */
export const DEMO_FULL = 'DEMO_FULL'
export const DEMO_RATE_LIMITED = 'DEMO_RATE_LIMITED'

/**
 * Crée l'hôte invité de la partie de démonstration (ou retrouve celui du navigateur) et rend son
 * quiz d'exemple. Le serveur pose le cookie de session de l'invité sur la réponse.
 */
export function startDemo(input: DemoStartInput): Promise<DemoStart> {
  return apiPost<DemoStart>('/api/demo', input)
}
