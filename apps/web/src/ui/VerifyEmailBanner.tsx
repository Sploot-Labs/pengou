import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useSession } from '../api/auth'
import { useAuthFeatures } from '../api/features'
import { useResendVerification } from './useResendVerification'

const DISMISS_KEY = 'pengou:verify-banner-dismissed'
// Écrans de jeu (hôte en direct, joueur, grand écran) : jamais de bandeau.
const HIDDEN_PREFIXES = ['/host/', '/play', '/join', '/screen/']

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Rappel de confirmation d'adresse (comptes non vérifiés, envoi d'e-mail activé) et accusé de
 * réception du retour du lien de confirmation (`/?email-verifie=1`). Fermeture mémorisée pour la
 * session du navigateur.
 */
export function VerifyEmailBanner() {
  const { user, refresh } = useSession()
  const { mailEnabled } = useAuthFeatures()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [confirmed, setConfirmed] = useState(false)
  const { state, error, resend } = useResendVerification(user?.email)

  const justVerified = params.get('email-verifie') === '1'
  // Une fois le paramètre retiré, `justVerified` repasse à faux : l'effet ne rejoue pas.
  useEffect(() => {
    if (!justVerified) return
    setConfirmed(true)
    void refresh()
    const next = new URLSearchParams(params)
    next.delete('email-verifie')
    setParams(next, { replace: true })
  }, [justVerified, params, refresh, setParams])

  function dismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Stockage indisponible : la fermeture ne vaut que pour cet affichage.
    }
  }

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null

  const showBanner = mailEnabled && !!user && user.emailVerified === false && !dismissed

  return (
    <>
      <div role="status" className={confirmed ? 'ab-verify-banner ab-verify-banner--ok' : undefined}>
        {confirmed ? 'Adresse e-mail confirmée.' : null}
      </div>
      {showBanner && (
        <section className="ab-verify-banner" aria-label="Confirmation de l'adresse e-mail">
          <p>Confirmez votre adresse pour créer plus d'un quiz.</p>
          <button
            type="button"
            className="ab-verify-banner__action"
            disabled={state === 'sending'}
            onClick={() => void resend()}
          >
            Renvoyer l'e-mail
          </button>
          <span role="status">{state === 'sent' ? 'E-mail envoyé' : ''}</span>
          {error && <span role="alert">{error}</span>}
          <button
            type="button"
            className="ab-verify-banner__action"
            onClick={dismiss}
          >
            Fermer
          </button>
        </section>
      )}
    </>
  )
}
