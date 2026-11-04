import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { requestPasswordReset } from '../api/auth'
import { ApiError } from '../api/client'
import { Button, Logo } from '../ui'
import { EmailSuggestion } from '../ui/EmailSuggestion'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Texte identique que l'adresse existe ou non : on ne révèle rien sur les comptes.
const NEUTRAL_MESSAGE =
  'Si un compte existe pour cette adresse, un e-mail vient de partir. Pensez à vérifier les indésirables.'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  // Valeur sur laquelle la suggestion est calculée : mise à jour à la perte de focus seulement.
  const [checkedEmail, setCheckedEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  const emailRef = useRef<HTMLInputElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  // Même logique que Login : le focus va au résumé d'erreur (WCAG 2.4.3 / 3.3.1).
  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setSent(false)

    if (!EMAIL_RE.test(email.trim())) {
      setEmailError('Adresse e-mail invalide.')
      emailRef.current?.focus()
      return
    }
    setEmailError(null)

    setPending(true)
    try {
      await requestPasswordReset(email.trim())
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setPending(false)
        setFormError('Trop de demandes, réessayez dans quelques minutes.')
        return
      }
      // Toute autre erreur (adresse inconnue, panne réseau, 5xx) : même confirmation neutre.
    }
    setPending(false)
    setSent(true)
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1>Mot de passe oublié</h1>
        <p className="join-subtitle">
          Indiquez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.
        </p>

        {formError && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {formError}
          </p>
        )}

        {sent && (
          <p className="join-status" role="status">
            {NEUTRAL_MESSAGE}
          </p>
        )}

        <div className="join-field">
          <label htmlFor="forgot-email">E-mail</label>
          <input
            id="forgot-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (emailError) setEmailError(null)
            }}
            onBlur={() => setCheckedEmail(email)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'forgot-email-error' : undefined}
          />
          <EmailSuggestion
            value={checkedEmail}
            onApply={(corrected) => {
              setEmail(corrected)
              setCheckedEmail(corrected)
            }}
          />
          {emailError && (
            <p className="join-error" id="forgot-email-error" role="alert">
              {emailError}
            </p>
          )}
        </div>

        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer le lien'}
        </Button>

        <p className="join-reassure">
          <Link to="/login">Retour à la connexion</Link>
        </p>
      </form>
    </main>
  )
}
