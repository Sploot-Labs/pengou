import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../api/auth'
import { ApiError } from '../api/client'
import { Button, Logo } from '../ui'

// Même longueur minimale que Signup.tsx.
const MIN_PASSWORD_LENGTH = 8

interface FieldErrors {
  password?: string
  confirm?: string
}

export function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const linkError = params.get('error')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [pending, setPending] = useState(false)

  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  // Focus sur le résumé d'erreur uniquement quand il apparaît (pas à chaque frappe).
  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

  if (!token || linkError || expired) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <div className="join-card">
          <h1>Nouveau mot de passe</h1>
          <p className="join-error" role="alert">
            Ce lien a expiré ou a déjà servi.
          </p>
          <p className="join-reassure">
            <Link to="/forgot-password">Faire une nouvelle demande</Link>
          </p>
        </div>
      </main>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const next: FieldErrors = {}
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Au moins ${MIN_PASSWORD_LENGTH} caractères.`
    }
    if (confirm !== password) {
      next.confirm = 'Les mots de passe ne correspondent pas.'
    }
    setErrors(next)
    if (next.password) {
      passwordRef.current?.focus()
      return
    }
    if (next.confirm) {
      confirmRef.current?.focus()
      return
    }

    setPending(true)
    try {
      await resetPassword(token as string, password)
      navigate('/login', { replace: true, state: { passwordReset: true } })
    } catch (err) {
      setPending(false)
      if (err instanceof ApiError && err.status === 400) {
        setExpired(true)
        return
      }
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Enregistrement impossible. Vérifiez votre connexion et réessayez.',
      )
    }
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1>Nouveau mot de passe</h1>
        <p className="join-subtitle">Choisissez un mot de passe d'au moins {MIN_PASSWORD_LENGTH} caractères.</p>

        {formError && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {formError}
          </p>
        )}

        <div className="join-field">
          <label htmlFor="reset-password">Nouveau mot de passe</label>
          <input
            id="reset-password"
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
            }}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'reset-password-error' : undefined}
          />
          {errors.password && (
            <p className="join-error" id="reset-password-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="reset-confirm">Confirmer le mot de passe</label>
          <input
            id="reset-confirm"
            ref={confirmRef}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: undefined }))
            }}
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? 'reset-confirm-error' : undefined}
          />
          {errors.confirm && (
            <p className="join-error" id="reset-confirm-error" role="alert">
              {errors.confirm}
            </p>
          )}
        </div>

        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </form>
    </main>
  )
}
