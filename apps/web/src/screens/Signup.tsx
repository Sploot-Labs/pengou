import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { normalizeSignupSource } from '@splootlabs/shared/signup-source'
import { signUp, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { fetchLegal, isLegalActive, type ActiveLegalInfo } from '../api/legal'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { useT } from '../i18n/useT'
import { safeNextPath, nextQuery } from '../nextPath'
import { Button, Logo } from '../ui'
import { EmailSuggestion } from '../ui/EmailSuggestion'
import { ExternalLink } from '../ui/ExternalLink'

interface FieldErrors {
  name?: string
  email?: string
  password?: string
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
  const { t } = useT()
  const navigate = useNavigate()
  const { refresh } = useSession()
  const [searchParams] = useSearchParams()
  const returnTo = safeNextPath(searchParams.get('next'))
  // Provenance posée par le site vitrine (`?from=<slug>`) : envoyée avec l'inscription, sans cookie.
  const from = normalizeSignupSource(searchParams.get('from'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailChecked, setEmailChecked] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [legalState, setLegalState] = useState<LegalState>({ status: 'loading' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
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
      next.name = t('Nom requis.')
    }
    if (!EMAIL_RE.test(email.trim())) {
      next.email = t('Adresse e-mail invalide.')
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = t('Mot de passe trop court : {min} caractères minimum, {count} saisis.', {
        min: MIN_PASSWORD_LENGTH,
        count: password.length,
      })
    }
    if (legal && !ageConfirmed) {
      next.age = t('Confirmez que vous avez 15 ans ou plus.')
    }
    if (legal && !termsAccepted) {
      next.terms = t("Acceptez les conditions d'utilisation pour créer votre compte.")
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
        ...(from ? { from } : {}),
      })
      // Same reasoning as Login: refresh the shared context before
      // navigating so <RequireAuth> on `/` sees the new session immediately.
      await refresh()
      // Sans destination imposée (invitation), l'accueil ouvre un quiz d'exemple à modifier.
      navigate(returnTo ?? '/?premier-quiz=1', { replace: true })
    } catch (err) {
      setPending(false)
      setFormError(
        err instanceof ApiError ? err.message : t('Inscription impossible. Vérifiez votre connexion et réessayez.'),
      )
    }
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1>{t('Inscription')}</h1>
        <p className="join-subtitle">{t('On vous fait de la place : quelques infos et votre compte est prêt.')}</p>

        {formError && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {formError}
          </p>
        )}

        <div className="join-field">
          <label htmlFor="signup-name">{t('Nom')}</label>
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
          <label htmlFor="signup-email">{t('E-mail')}</label>
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
          <label htmlFor="signup-password">{t('Mot de passe')}</label>
          {/* Un seul champ, avec « Afficher » pour vérifier la saisie : remplace la confirmation. */}
          <div className="join-password">
            <input
              id="signup-password"
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
              }}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'signup-password-hint signup-password-error' : 'signup-password-hint'}
            />
            <Button
              variant="ghost"
              type="button"
              aria-controls="signup-password"
              aria-label={showPassword ? t('Masquer le mot de passe') : t('Afficher le mot de passe')}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? t('Masquer') : t('Afficher')}
            </Button>
          </div>
          <p className="join-hint" id="signup-password-hint">
            {t('{min} caractères minimum.', { min: MIN_PASSWORD_LENGTH })}
          </p>
          {errors.password && (
            <p className="join-error" id="signup-password-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>

        {legalState.status === 'error' && (
          <>
            <p className="join-error" role="alert">
              {t("Impossible de charger les conditions d'utilisation. Vérifiez votre connexion et réessayez.")}
            </p>
            <Button variant="ghost" type="button" onClick={() => void loadLegal()}>
              {t('Réessayer')}
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
                <label htmlFor="signup-age">{t("J'ai 15 ans ou plus")}</label>
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
                  {t("J'accepte les")}{' '}
                  <ExternalLink href={legal.termsUrl}>{t("conditions d'utilisation")}</ExternalLink>
                </label>
              </div>
              {errors.terms && (
                <p className="join-error" id="signup-terms-error" role="alert">
                  {errors.terms}
                </p>
              )}
            </div>

            <p className="join-legal">
              {t('La')} <ExternalLink href={legal.privacyUrl}>{t('politique de confidentialité')}</ExternalLink>{' '}
              {t('explique comment vos données sont traitées.')}
            </p>
          </>
        )}

        <Button variant="primary" type="submit" disabled={pending || legalState.status !== 'ready'}>
          {pending ? t('Inscription…') : t("S'inscrire")}
        </Button>

        <p className="join-reassure">
          {t('Déjà un compte ?')} <Link to={`/login${nextQuery(returnTo, from)}`}>{t('Se connecter')}</Link>
        </p>
      </form>
      <LanguageSelect className="join-lang" />
    </main>
  )
}
