import { useEffect, useState } from 'react'
import { apiGet } from './client'

/** Fonctionnalités serveur publiques (`GET /api/auth-features`). */
export interface AuthFeatures {
  mailEnabled: boolean
}

// Un seul fetch pour la durée de vie de la page, partagé par tous les composants.
let cached: Promise<AuthFeatures> | null = null

function loadFeatures(): Promise<AuthFeatures> {
  if (!cached) {
    cached = apiGet<AuthFeatures>('/api/auth-features').catch(() => {
      // Échec réseau ou serveur : on se replie sur « sans e-mail » et on permet un nouvel essai.
      cached = null
      return { mailEnabled: false }
    })
  }
  return cached
}

export function useAuthFeatures(): { mailEnabled: boolean; loading: boolean } {
  const [state, setState] = useState<{ mailEnabled: boolean; loading: boolean }>({
    mailEnabled: false,
    loading: true,
  })

  useEffect(() => {
    let active = true
    void loadFeatures().then((features) => {
      if (active) setState({ mailEnabled: features.mailEnabled === true, loading: false })
    })
    return () => {
      active = false
    }
  }, [])

  return state
}
