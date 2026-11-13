import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { normalizeSignupSource } from '@splootlabs/shared/signup-source'
import { setActiveTenantId } from '../api/activeTenant'
import { useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { DEMO_FULL, DEMO_RATE_LIMITED, startDemo } from '../api/demo'
import { useAuthFeatures } from '../api/features'
import { fetchLegal, isLegalActive, type ActiveLegalInfo } from '../api/legal'
import { useSharedGameSocket } from '../realtime/GameSocketProvider'
import { useLaunchGame } from '../realtime/useLaunchGame'
import { Button, Logo } from '../ui'
import { ExternalLink } from '../ui/ExternalLink'

/** Conditions d'utilisation de l'instance : en cours de chargement, actives, absentes (null) ou injoignables. */
type LegalState = { status: 'loading' } | { status: 'ready'; legal: ActiveLegalInfo | null } | { status: 'error' }

/** Titre affiché par l'écran hôte : le serveur ne renvoie que l'identifiant du quiz d'exemple. */
const DEMO_QUIZ_TITLE = 'Quiz de démonstration'

/** Inscription proposée depuis la démonstration : la provenance `demo` sort dans l'export des inscriptions. */
const SIGNUP_FROM_DEMO = '/signup?from=demo'

/**
 * Partie de démonstration sans compte (`/demo`), destination du bouton « Essayer sans compte » du
 * site. Seul le clic sur « Lancer la démonstration » crée quelque chose : le serveur crée alors un
 * hôte invité avec le quiz d'exemple, puis l'écran lance la partie comme le ferait un hôte inscrit
 * et ouvre le salon. Rien n'est créé par une simple visite (robot, aperçu de lien).
 */
export function Demo() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, refresh } = useSession()
  const { demoEnabled, demoMaxPlayers, loading: featuresLoading } = useAuthFeatures()
  const { launch } = useLaunchGame()
  const { reconnect } = useSharedGameSocket()

  const [legalState, setLegalState] = useState<LegalState>({ status: 'loading' })
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [ageError, setAgeError] = useState<string | null>(null)
  const [formError, setFormError] = useState<{ message: string; offerSignup: boolean } | null>(null)
  const [pending, setPending] = useState(false)
  // Garde synchrone du double clic : l'état `pending` n'est lu qu'au rendu suivant.
  const pendingRef = useRef(false)
  const ageRef = useRef<HTMLInputElement>(null)

  const loadLegal = useCallback(async () => {
    setLegalState({ status: 'loading' })
    try {
      const info = await fetchLegal()
      setLegalState({ status: 'ready', legal: isLegalActive(info) ? info : null })
    } catch {
      setLegalState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void loadLegal()
  }, [loadLegal])

  const legal = legalState.status === 'ready' ? legalState.legal : null
  const from = normalizeSignupSource(searchParams.get('from')) ?? undefined

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pendingRef.current || legalState.status !== 'ready') return
    if (legal && !ageConfirmed) {
      setAgeError('Confirmez que vous avez 15 ans ou plus.')
      ageRef.current?.focus()
      return
    }
    pendingRef.current = true
    setPending(true)
    setFormError(null)
    try {
      const demo = await startDemo({ ageConfirmed: true, acceptedTermsVersion: legal?.termsVersion, from })
      // L'espace de l'invité devient l'espace actif (en-tête des requêtes et poignée de main de la
      // socket), puis la session est relue : l'écran hôte est protégé par elle.
      setActiveTenantId(demo.tenantId)
      await refresh()
      // La socket partagée s'était connectée avant que l'invité existe (ou, dans un second onglet,
      // avant qu'il soit connu de cet onglet), donc sans son cookie de session : elle refait sa
      // poignée de main avant de créer la partie comme avant de la reprendre.
      reconnect()
      if (demo.liveSessionId) {
        navigate(`/host/${demo.liveSessionId}`)
        return
      }
      await launch(demo.quizId, DEMO_QUIZ_TITLE)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      setFormError({
        message: err instanceof Error ? err.message : 'Impossible de lancer la démonstration. Réessayez.',
        offerSignup: code === DEMO_FULL || code === DEMO_RATE_LIMITED,
      })
      pendingRef.current = false
      setPending(false)
    }
  }

  const intro = (
    <>
      <h1>Essayez Pengou sans créer de compte</h1>
      <p className="join-subtitle">
        Une vraie partie du quiz d'exemple, jusqu'à {demoMaxPlayers} joueurs. Rien n'est conservé après la
        démonstration.
      </p>
    </>
  )

  if (!featuresLoading && !demoEnabled) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <div className="join-card">
          {intro}
          <p>La démonstration n'est pas disponible sur cette instance.</p>
          <p className="join-switch">
            <Link to={SIGNUP_FROM_DEMO}>Créer un compte gratuit</Link>
          </p>
        </div>
      </main>
    )
  }

  if (user && user.isAnonymous !== true) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <div className="join-card">
          {intro}
          <p>Vous êtes déjà connecté : la démonstration s'adresse aux visiteurs sans compte.</p>
          <p className="join-switch">
            <Link to="/">Ouvrir mon espace</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />
      <form className="join-card" onSubmit={handleSubmit} noValidate>
        {intro}

        {formError && (
          <>
            <p className="join-error" role="alert">
              {formError.message}
            </p>
            {formError.offerSignup && (
              <p className="join-switch">
                <Link to={SIGNUP_FROM_DEMO}>Créer un compte gratuit</Link>
              </p>
            )}
          </>
        )}

        {legalState.status === 'error' && (
          <>
            <p className="join-error" role="alert">
              Impossible de charger les conditions d'utilisation. Vérifiez votre connexion et réessayez.
            </p>
            <Button variant="ghost" type="button" onClick={() => void loadLegal()}>
              Réessayer
            </Button>
          </>
        )}

        {legal && (
          <div className="join-field">
            <div className="join-check">
              <input
                id="demo-age"
                ref={ageRef}
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => {
                  setAgeConfirmed(e.target.checked)
                  if (e.target.checked) setAgeError(null)
                }}
                aria-invalid={ageError ? true : undefined}
                aria-describedby={ageError ? 'demo-age-error' : undefined}
              />
              <label htmlFor="demo-age">J'ai 15 ans ou plus</label>
            </div>
            {ageError && (
              <p className="join-error" id="demo-age-error" role="alert">
                {ageError}
              </p>
            )}
          </div>
        )}

        <Button variant="primary" type="submit" disabled={pending || legalState.status !== 'ready'}>
          {pending ? 'Lancement…' : 'Lancer la démonstration'}
        </Button>

        {legal && (
          <p className="join-hint">
            En lançant la démonstration, vous acceptez les{' '}
            <ExternalLink href={legal.termsUrl}>conditions d'utilisation</ExternalLink>.
          </p>
        )}

        <p className="join-switch">
          Déjà convaincu ? <Link to={SIGNUP_FROM_DEMO}>Créer mon compte</Link>
        </p>
      </form>
    </main>
  )
}
