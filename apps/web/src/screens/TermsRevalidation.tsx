import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { acceptTerms, fetchLegal, formatTermsDate, isLegalActive, type ActiveLegalInfo } from '../api/legal'
import { Button, Logo } from '../ui'
import { ExternalLink } from '../ui/ExternalLink'

const CHECK_ERROR = "Cochez la case pour accepter les conditions d'utilisation."

/**
 * Écran bloquant affiché par `<RequireAuth>` quand l'hôte connecté n'a pas accepté la version
 * courante des CGU (compte antérieur, compte créé par un fournisseur tiers, ou CGU modifiées).
 * L'API refuse les routes protégées tant que l'acceptation n'est pas enregistrée ; seules la
 * session, la déconnexion et l'acceptation restent ouvertes, d'où le bouton de déconnexion.
 *
 * Focus sur le titre à l'affichage : l'écran remplace celui que l'hôte attendait, il doit être
 * annoncé tout de suite.
 */
export function TermsRevalidation() {
  const navigate = useNavigate()
  const { refresh } = useSession()
  const [legal, setLegal] = useState<ActiveLegalInfo | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [checked, setChecked] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const headingRef = useRef<HTMLHeadingElement>(null)
  const checkRef = useRef<HTMLInputElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  const load = useCallback(async () => {
    setLoadFailed(false)
    try {
      const info = await fetchLegal()
      setLegal(isLegalActive(info) ? info : null)
      return info
    } catch {
      setLoadFailed(true)
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!legal) return
    if (!checked) {
      setCheckError(CHECK_ERROR)
      checkRef.current?.focus()
      return
    }
    setPending(true)
    try {
      await acceptTerms(legal.termsVersion)
      await refresh()
    } catch (err) {
      setPending(false)
      if (err instanceof ApiError && err.code === 'TERMS_VERSION_MISMATCH') {
        // Les CGU ont changé pendant la lecture : on affiche la nouvelle version, à relire.
        setChecked(false)
        await load()
      }
      setFormError(
        err instanceof ApiError ? err.message : 'Enregistrement impossible. Vérifiez votre connexion et réessayez.',
      )
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      // Au mieux : même raisonnement que Home.handleSignOut.
    } finally {
      await refresh()
      navigate('/login')
    }
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      <form className="join-card" onSubmit={handleSubmit} noValidate aria-labelledby="cgu-titre">
        <h1 id="cgu-titre" tabIndex={-1} ref={headingRef}>
          Les conditions d'utilisation ont changé
        </h1>
        {legal ? (
          <p className="join-subtitle">
            Une nouvelle version, datée du {formatTermsDate(legal.termsVersion)}, est en vigueur. Lisez-la puis
            acceptez-la pour continuer à utiliser votre compte.
          </p>
        ) : (
          !loadFailed && <p role="status">Chargement des conditions d'utilisation…</p>
        )}

        {loadFailed && (
          <>
            <p className="join-error" role="alert">
              Impossible de charger les conditions d'utilisation. Vérifiez votre connexion et réessayez.
            </p>
            <Button variant="ghost" type="button" onClick={() => void load()}>
              Réessayer
            </Button>
          </>
        )}

        {formError && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {formError}
          </p>
        )}

        {legal && (
          <>
            <p>
              Lire les <ExternalLink href={legal.termsUrl}>conditions d'utilisation</ExternalLink>
            </p>

            <div className="join-field">
              <div className="join-check">
                <input
                  id="cgu-acceptation"
                  ref={checkRef}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setChecked(e.target.checked)
                    if (e.target.checked) setCheckError(null)
                  }}
                  aria-invalid={checkError ? true : undefined}
                  aria-describedby={checkError ? 'cgu-acceptation-error' : undefined}
                />
                <label htmlFor="cgu-acceptation">J'accepte les conditions d'utilisation</label>
              </div>
              {checkError && (
                <p className="join-error" id="cgu-acceptation-error" role="alert">
                  {checkError}
                </p>
              )}
            </div>

            <Button variant="primary" type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Accepter et continuer'}
            </Button>
          </>
        )}

        <p className="join-reassure">
          <Button variant="ghost" type="button" onClick={() => void handleSignOut()} disabled={signingOut}>
            {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </Button>
        </p>
      </form>
    </main>
  )
}
