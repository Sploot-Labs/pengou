import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signUp, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { safeNextPath, nextQuery } from '../nextPath'
import { Button, Logo } from '../ui'
import { EmailSuggestion } from '../ui/EmailSuggestion'

interface FieldErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

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
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

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

    setPending(true)
    try {
      await signUp({ email: email.trim(), password, name: name.trim() })
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

        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? 'Inscription…' : "S'inscrire"}
        </Button>

        <p className="join-reassure">
          Déjà un compte ? <Link to={`/login${nextQuery(returnTo)}`}>Se connecter</Link>
        </p>
      </form>
    </main>
  )
}
