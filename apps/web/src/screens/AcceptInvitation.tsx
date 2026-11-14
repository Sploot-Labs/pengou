import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from '../api/auth'
import { useWorkspaces } from '../api/workspace-context'
import { ApiError } from '../api/client'
import { fetchInvitationPreview, acceptInvitation, type InvitationPreview } from '../api/workspaces'
import type { WebKey } from '../i18n/catalog'
import { t as translate } from '../i18n/t'
import { useT } from '../i18n/useT'
import { nextQuery } from '../nextPath'
import { AppHeader } from '../ui/AppHeader'
import { Button } from '../ui'

const ROLE_LABEL: Record<string, WebKey> = { owner: 'propriétaire', admin: 'administrateur', member: 'membre' }

/**
 * Écran d'acceptation d'invitation (Slice 3c) — PUBLIC (l'aperçu ne requiert pas de session : le
 * token est la capacité). Un invité déjà connecté peut accepter directement ; un invité sans compte
 * voit dans quel workspace il est invité puis est renvoyé vers connexion/inscription. Après
 * acceptation, on bascule le workspace actif sur celui rejoint et on recharge l'accueil.
 */
export function AcceptInvitation() {
  const { t } = useT()
  const { token = '' } = useParams()
  // Preuve du lien e-mailé : la renvoyer à l'acceptation confirme l'adresse.
  const [searchParams] = useSearchParams()
  const proof = searchParams.get('v')
  const { user } = useSession()
  // Retour sur ce lien (preuve `v` comprise) après connexion ou inscription.
  const returnQuery = nextQuery(
    `/invitations/${encodeURIComponent(token)}${proof ? `?v=${encodeURIComponent(proof)}` : ''}`,
  )
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
        setLoadError(err instanceof ApiError ? err.message : translate('Invitation introuvable.'))
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
      const { tenantId } = await acceptInvitation(token, proof)
      setActive(tenantId)
      // Rechargement dur : la nouvelle membership + le nouveau contexte tenant sont pris en compte.
      window.location.assign('/')
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : t("Impossible d'accepter l'invitation."))
      setAccepting(false)
    }
  }

  const roleKey = preview ? ROLE_LABEL[preview.role] : undefined
  const unusable = preview && (preview.expired || preview.status !== 'pending')

  return (
    <div className="ab-shell">
      <AppHeader />
      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <section className="home-hero">
          <div>
            <h1>{t('Invitation')}</h1>
            {preview && (
              <p className="home-hero__sub">
                {t('Vous êtes invité·e à rejoindre')} <strong>{preview.workspaceName}</strong> {t('en tant que')}{' '}
                {roleKey ? t(roleKey) : preview.role}.
              </p>
            )}
          </div>
        </section>

        {loading && <p role="status">{t("Chargement de l'invitation…")}</p>}
        {loadError && !loading && (
          <div className="ab-empty-state">
            <p role="alert">{loadError}</p>
            <Link className="ab-button ab-button--primary" to="/">
              {t("Retour à l'accueil")}
            </Link>
          </div>
        )}

        {preview && !loading && (
          <section className="ab-panel" style={{ maxWidth: 520 }}>
            {unusable ? (
              <p role="alert" className="join-error">
                {preview.expired
                  ? t('Cette invitation a expiré. Demandez-en une nouvelle.')
                  : t('Cette invitation a déjà été utilisée ou révoquée.')}
              </p>
            ) : user ? (
              <>
                {acceptError && (
                  <p role="alert" className="join-error">
                    {acceptError}
                  </p>
                )}
                <p>
                  {t('Connecté·e en tant que')} <strong>{user.email}</strong>.
                </p>
                <Button variant="primary" type="button" disabled={accepting} onClick={() => void handleAccept()}>
                  {accepting ? t('Acceptation…') : t('Rejoindre {name}', { name: preview.workspaceName })}
                </Button>
              </>
            ) : (
              <>
                <p>{t('Connectez-vous ou créez un compte pour rejoindre ce workspace.')}</p>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Link className="ab-button ab-button--primary" to={`/login${returnQuery}`}>
                    {t('Se connecter')}
                  </Link>
                  <Link className="ab-button ab-button--ghost" to={`/signup${returnQuery}`}>
                    {t('Créer un compte')}
                  </Link>
                </div>
                <p className="home-card__meta" style={{ marginTop: 'var(--space-3)' }}>
                  {t('Revenez sur ce lien une fois connecté·e pour finaliser.')}
                </p>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
