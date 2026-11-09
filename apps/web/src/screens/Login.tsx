import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { signIn, useSession } from '../api/auth'
import { useAuthFeatures } from '../api/features'
import { ApiError } from '../api/client'
import { safeNextPath, nextQuery } from '../nextPath'
import { Button, Logo } from '../ui'

interface FieldErrors {
  email?: string
  password?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mailEnabled } = useAuthFeatures()
  const passwordReset = (location.state as { passwordReset?: boolean } | null)?.passwordReset === true
  const { refresh } = useSession()
  const returnTo = safeNextPath(useSearchParams()[0].get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  // WCAG 2.4.3 / 3.3.1: when the server rejects the submission, move focus to
  // the error summary so keyboard/screen-reader users land on it directly
  // instead of staying on the (already-focused, now-disabled) submit button.
  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!EMAIL_RE.test(email.trim())) {
      next.email = 'Adresse e-mail invalide.'
    }
    if (password.length === 0) {
      next.password = 'Mot de passe requis.'
    }
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    // Validate both fields at once, focus the first invalid one — no
    // sequential back-and-forth.
    const next = validate()
    setErrors(next)
    if (next.email) {
      emailRef.current?.focus()
      return
    }
    if (next.password) {
      passwordRef.current?.focus()
      return
    }

    setPending(true)
    try {
      await signIn({ email: email.trim(), password })
      // Update the shared session context BEFORE navigating: <RequireAuth>
      // on `/` reads this same context, and without the refresh it would
      // still see the pre-login (logged-out) state and bounce straight
      // back to /login.
      await refresh()
      navigate(returnTo ?? '/', { replace: true })
    } catch (err) {
      setPending(false)
      setFormError(
        err instanceof ApiError ? err.message : 'Connexion impossible. Vérifiez votre connexion et réessayez.',
      )
    }
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1>Connexion</h1>
        <p className="join-subtitle">Content de vous revoir : vos parties vous attendent.</p>

        {passwordReset && (
          <p className="join-status" role="status">
            Mot de passe modifié. Vous pouvez vous connecter.
          </p>
        )}

        {formError && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {formError}
          </p>
        )}

        <div className="join-field">
          <label htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
          {errors.email && (
            <p className="join-error" id="login-email-error" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="login-password">Mot de passe</label>
          <input
            id="login-password"
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
            }}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
          />
          {errors.password && (
            <p className="join-error" id="login-password-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>

        {mailEnabled && (
          <p className="join-reassure">
            <Link to="/forgot-password">Mot de passe oublié ?</Link>
          </p>
        )}

        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </Button>

        <p className="join-reassure">
          Pas encore de compte ? <Link to={`/signup${nextQuery(returnTo)}`}>Créer un compte</Link>
        </p>
      </form>
    </main>
  )
}
