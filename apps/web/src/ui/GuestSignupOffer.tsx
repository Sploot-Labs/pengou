import { Link } from 'react-router-dom'
import { useSessionOptional } from '../api/auth'
import { useT } from '../i18n/useT'

/** Inscription proposée depuis la démonstration : la provenance `demo` sort dans l'export des inscriptions. */
const SIGNUP_FROM_DEMO = '/signup?from=demo'

/**
 * Fin d'une partie de démonstration : propose à l'hôte invité de créer un vrai compte. Ne rend rien
 * pour un compte ordinaire, ni sur un écran monté sans fournisseur de session.
 *
 * Un simple lien, sans fermer la session de l'invité : l'écran hôte est protégé, et fermer la
 * session le ferait rediriger vers la connexion avant que la navigation vers l'inscription
 * n'aboutisse. L'inscription crée un compte à part, qui remplace la session de l'invité ; le compte
 * invité, lui, est supprimé par la purge du serveur.
 */
export function GuestSignupOffer() {
  const session = useSessionOptional()
  const { t } = useT()
  if (session?.user?.isAnonymous !== true) return null

  return (
    <aside className="hostlive-guest-offer" aria-label={t('Après la démonstration')}>
      <p>
        {t(
          "La démonstration s'arrête ici et rien n'est conservé. Avec un compte gratuit, vous créez vos propres quiz et vous gardez vos résultats.",
        )}
      </p>
      <Link className="ab-button ab-button--primary" to={SIGNUP_FROM_DEMO}>
        {t('Créer mon compte pour faire mes propres quiz')}
      </Link>
    </aside>
  )
}
