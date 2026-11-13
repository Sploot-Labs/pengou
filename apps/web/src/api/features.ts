import { useEffect, useState } from 'react'
import { apiGet } from './client'

/** Fonctionnalités serveur publiques (`GET /api/auth-features`). */
export interface AuthFeatures {
  mailEnabled: boolean
  /** Partie de démonstration sans compte (`/demo`) proposée par l'instance. */
  demoEnabled: boolean
  /** Nombre de joueurs d'une démonstration, annoncé sur l'écran `/demo`. */
  demoMaxPlayers: number
}

/** Repli tant que le serveur n'a pas répondu, ou s'il est injoignable. */
const FALLBACK: AuthFeatures = { mailEnabled: false, demoEnabled: false, demoMaxPlayers: 30 }

// Un seul fetch pour la durée de vie de la page, partagé par tous les composants.
let cached: Promise<AuthFeatures> | null = null

function loadFeatures(): Promise<AuthFeatures> {
  if (!cached) {
    cached = apiGet<AuthFeatures>('/api/auth-features').catch(() => {
      // Échec réseau ou serveur : on se replie sur « sans e-mail, sans démonstration » et on permet
      // un nouvel essai.
      cached = null
      return FALLBACK
    })
  }
  return cached
}

export function useAuthFeatures(): AuthFeatures & { loading: boolean } {
  const [state, setState] = useState<AuthFeatures & { loading: boolean }>({ ...FALLBACK, loading: true })

  useEffect(() => {
    let active = true
    void loadFeatures().then((features) => {
      if (!active) return
      setState({
        mailEnabled: features.mailEnabled === true,
        demoEnabled: features.demoEnabled === true,
        demoMaxPlayers: typeof features.demoMaxPlayers === 'number' ? features.demoMaxPlayers : FALLBACK.demoMaxPlayers,
        loading: false,
      })
    })
    return () => {
      active = false
    }
  }, [])

  return state
}
