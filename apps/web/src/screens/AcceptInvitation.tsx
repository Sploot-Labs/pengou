import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../api/auth'
import { useWorkspaces } from '../api/workspace-context'
import { ApiError } from '../api/client'
import { fetchInvitationPreview, acceptInvitation, type InvitationPreview } from '../api/workspaces'
import { AppHeader } from '../ui/AppHeader'
import { Button } from '../ui'

const ROLE_LABEL: Record<string, string> = { owner: 'propriétaire', admin: 'administrateur', member: 'membre' }

/**
 * Écran d'acceptation d'invitation (Slice 3c) — PUBLIC (l'aperçu ne requiert pas de session : le
 * token est la capacité). Un invité déjà connecté peut accepter directement ; un invité sans compte
 * voit dans quel workspace il est invité puis est renvoyé vers connexion/inscription. Après
 * acceptation, on bascule le workspace actif sur celui rejoint et on recharge l'accueil.
 */
export function AcceptInvitation() {
  const { token = '' } = useParams()
  const { user } = useSession()
  const { setActive } = useWorkspaces()

  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchInvitationPreview(token)
      .then((p) => {
        if (!cancelled) {
          setPreview(p)
          setLoadError(null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof ApiError ? err.message : 'Invitation introuvable.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleAccept() {
    setAccepting(true)
    setAcceptError(null)
    try {
      const { tenantId } = await acceptInvitation(token)
      setActive(tenantId)
      // Rechargement dur : la nouvelle membership + le nouveau contexte tenant sont pris en compte.
      window.location.assign('/')
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : "Impossible d'accepter l'invitation.")
      setAccepting(false)
    }
  }

  const unusable = preview && (preview.expired || preview.status !== 'pending')

  return (
    <div className="ab-shell">
      <AppHeader />
      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <section className="home-hero">
          <div>
            <h1>Invitation</h1>
            {preview && (
              <p className="home-hero__sub">
                Vous êtes invité·e à rejoindre <strong>{preview.workspaceName}</strong> en tant que{' '}
                {ROLE_LABEL[preview.role] ?? preview.role}.
              </p>
            )}
          </div>
        </section>

        {loading && <p role="status">Chargement de l'invitation…</p>}
        {loadError && !loading && (
          <div className="ab-empty-state">
            <p role="alert">{loadError}</p>
            <Link className="ab-button ab-button--primary" to="/">
              Retour à l'accueil
            </Link>
          </div>
        )}

        {preview && !loading && (
          <section className="ab-panel" style={{ maxWidth: 520 }}>
            {unusable ? (
              <p role="alert" className="join-error">
                {preview.expired
                  ? 'Cette invitation a expiré. Demandez-en une nouvelle.'
                  : 'Cette invitation a déjà été utilisée ou révoquée.'}
              </p>
            ) : user ? (
              <>
                {acceptError && (
                  <p role="alert" className="join-error">
                    {acceptError}
                  </p>
                )}
                <p>
                  Connecté·e en tant que <strong>{user.email}</strong>.
                </p>
                <Button variant="primary" type="button" disabled={accepting} onClick={() => void handleAccept()}>
                  {accepting ? 'Acceptation…' : `Rejoindre ${preview.workspaceName}`}
                </Button>
              </>
            ) : (
              <>
                <p>Connectez-vous ou créez un compte pour rejoindre ce workspace.</p>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Link className="ab-button ab-button--primary" to="/login">
                    Se connecter
                  </Link>
                  <Link className="ab-button ab-button--ghost" to="/signup">
                    Créer un compte
                  </Link>
                </div>
                <p className="home-card__meta" style={{ marginTop: 'var(--space-3)' }}>
                  Revenez sur ce lien une fois connecté·e pour finaliser.
                </p>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
