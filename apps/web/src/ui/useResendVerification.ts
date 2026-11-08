import { useState } from 'react'
import { sendVerificationEmail } from '../api/auth'
import { ApiError } from '../api/client'

export type ResendState = 'idle' | 'sending' | 'sent' | 'error'

/** Renvoi de l'e-mail de confirmation : état du bouton et message d'erreur éventuel. */
export function useResendVerification(email?: string) {
  const [state, setState] = useState<ResendState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    setState('sending')
    setError(null)
    try {
      await sendVerificationEmail(email)
      setState('sent')
    } catch (err) {
      setState('error')
      setError(err instanceof ApiError ? err.message : "L'e-mail n'a pas pu partir. Réessayez.")
    }
  }

  return { state, error, resend }
}
