import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signUp, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { fetchLegal, isLegalActive, type ActiveLegalInfo } from '../api/legal'
import { safeNextPath, nextQuery } from '../nextPath'
import { Button, Logo } from '../ui'
import { EmailSuggestion } from '../ui/EmailSuggestion'
import { ExternalLink } from '../ui/ExternalLink'

interface FieldErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
  age?: string
  terms?: string
}

/** CGU de l'instance : en cours de chargement, actives, désactivées (null) ou injoignables. */
type LegalState = { status: 'loading' } | { status: 'ready'; legal: ActiveLegalInfo | null } | { status: 'error' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Matches the server's Better Auth default (verified by hand: a 7-char
// password is rejected with "Password too short", 8 chars succeeds).
const MIN_PASSWORD_LENGTH = 8

export function Signup() {
  const navigate = useNavigate()
  const { refresh } = useSession()
  const returnTo = safeNextPath(useSearchParams()[0].get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailChecked, setEmailChecked] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [legalState, setLegalState] = useState<LegalState>({ status: 'loading' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const ageRef = useRef<HTMLInputElement>(null)
  const termsRef = useRef<HTMLInputElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

  // Les CGU dépendent de l'instance : sans version configurée, le formulaire reste sans case.
  // Tant que la configuration n'est pas connue, l'envoi est bloqué (le serveur refuserait de
  // toute façon une inscription sans acceptation sur une instance qui l'exige).
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

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (name.trim().length === 0) {
      next.name = 'Nom requis.'
    }
    if (!EMAIL_RE.test(email.trim())) {
      next.email = 'Adresse e-mail invalide.'
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Mot de passe trop court (minimum ${MIN_PASSWORD_LENGTH} caractères).`
    }
    if (confirmPassword !== password) {
      next.confirmPassword = 'Les mots de passe ne correspondent pas.'
    }
    if (legal && !ageConfirmed) {
      next.age = 'Confirmez que vous avez 15 ans ou plus.'
    }
    if (legal && !termsAccepted) {
      next.terms = "Acceptez les conditions d'utilisation pour créer votre compte."
    }
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const next = validate()
    setErrors(next)
    if (next.name) {
      nameRef.current?.focus()
      return
    }
    if (next.email) {
      emailRef.current?.focus()
      return
    }
    if (next.password) {
      passwordRef.current?.focus()
      return
    }
    if (next.confirmPassword) {
      confirmPasswordRef.current?.focus()
      return
    }
    if (next.age) {
      ageRef.current?.focus()
      return
    }
    if (next.terms) {
      termsRef.current?.focus()
      return
    }

    setPending(true)
    try {
      await signUp({
        email: email.trim(),
        password,
        name: name.trim(),
        ...(legal ? { acceptedTermsVersion: legal.termsVersion, ageConfirmed: true } : {}),
      })
      // Same reasoning as Login: refresh the shared context before
      // navigating so <RequireAuth> on `/` sees the new session immediately.
      await refresh()
      navigate(returnTo ?? '/', { replace: true })
    } catch (err) {
      setPending(false)
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Inscription impossible. Vérifiez votre connexion et réessayez.',
      )
    }
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1>Inscription</h1>
        <p className="join-subtitle">On vous fait de la place : quelques infos et votre compte est prêt.</p>

        {formError && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {formError}
          </p>
        )}

        <div className="join-field">
          <label htmlFor="signup-name">Nom</label>
          <input
            id="signup-name"
            ref={nameRef}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'signup-name-error' : undefined}
          />
          {errors.name && (
            <p className="join-error" id="signup-name-error" role="alert">
              {errors.name}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="signup-email">E-mail</label>
          <input
            id="signup-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
            }}
            onBlur={() => setEmailChecked(email)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'signup-email-error' : undefined}
          />
          <EmailSuggestion
            value={emailChecked}
            onApply={(fixed) => {
              setEmail(fixed)
              setEmailChecked(fixed)
            }}
          />
          {errors.email && (
            <p className="join-error" id="signup-email-error" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="signup-password">Mot de passe</label>
          <input
            id="signup-password"
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
            }}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'signup-password-error' : undefined}
          />
          {errors.password && (
            <p className="join-error" id="signup-password-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="signup-confirm-password">Confirmer le mot de passe</label>
          <input
            id="signup-confirm-password"
            ref={confirmPasswordRef}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              if (errors.confirmPassword) {
                setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
              }
            }}
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? 'signup-confirm-password-error' : undefined}
          />
          {errors.confirmPassword && (
            <p className="join-error" id="signup-confirm-password-error" role="alert">
              {errors.confirmPassword}
            </p>
          )}
        </div>

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
          <>
            <div className="join-field">
              <div className="join-check">
                <input
                  id="signup-age"
                  ref={ageRef}
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={(e) => {
                    setAgeConfirmed(e.target.checked)
                    if (e.target.checked && errors.age) setErrors((prev) => ({ ...prev, age: undefined }))
                  }}
                  aria-invalid={errors.age ? true : undefined}
                  aria-describedby={errors.age ? 'signup-age-error' : undefined}
                />
                <label htmlFor="signup-age">J'ai 15 ans ou plus</label>
              </div>
              {errors.age && (
                <p className="join-error" id="signup-age-error" role="alert">
                  {errors.age}
                </p>
              )}
            </div>

            <div className="join-field">
              <div className="join-check">
                <input
                  id="signup-terms"
                  ref={termsRef}
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => {
                    setTermsAccepted(e.target.checked)
                    if (e.target.checked && errors.terms) setErrors((prev) => ({ ...prev, terms: undefined }))
                  }}
                  aria-invalid={errors.terms ? true : undefined}
                  aria-describedby={errors.terms ? 'signup-terms-error' : undefined}
                />
                <label htmlFor="signup-terms">
                  J'accepte les <ExternalLink href={legal.termsUrl}>conditions d'utilisation</ExternalLink>
                </label>
              </div>
              {errors.terms && (
                <p className="join-error" id="signup-terms-error" role="alert">
                  {errors.terms}
                </p>
              )}
            </div>

            <p className="join-legal">
              La <ExternalLink href={legal.privacyUrl}>politique de confidentialité</ExternalLink> explique comment
              vos données sont traitées.
            </p>
          </>
        )}

        <Button variant="primary" type="submit" disabled={pending || legalState.status !== 'ready'}>
          {pending ? 'Inscription…' : "S'inscrire"}
        </Button>

        <p className="join-reassure">
          Déjà un compte ? <Link to={`/login${nextQuery(returnTo)}`}>Se connecter</Link>
        </p>
      </form>
    </main>
  )
}
