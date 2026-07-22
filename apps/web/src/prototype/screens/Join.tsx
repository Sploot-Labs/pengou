import { useEffect, useRef, useState, type FormEvent } from 'react'
import { mockGamePin } from '../mockData'
import { Button, Logo, PinDisplay } from '../ui'

interface FieldErrors {
  pin?: string
  pseudo?: string
}

type Status = 'idle' | 'pending' | 'joined'

export function Join() {
  const [pin, setPin] = useState('')
  const [pseudo, setPseudo] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<Status>('idle')
  const pinRef = useRef<HTMLInputElement>(null)
  const pseudoRef = useRef<HTMLInputElement>(null)
  const welcomeRef = useRef<HTMLHeadingElement>(null)

  // WCAG 2.4.3: when the form is replaced by the confirmation card, the
  // focused submit button is unmounted and focus would fall back to <body>.
  // Move it to the welcome heading instead.
  useEffect(() => {
    if (status === 'joined') welcomeRef.current?.focus()
  }, [status])

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    const digitsOnly = pin.replace(/\D/g, '')
    if (digitsOnly.length !== 6 || digitsOnly !== mockGamePin) {
      next.pin = 'PIN introuvable. Vérifiez les 6 chiffres.'
    }
    if (pseudo.trim().length === 0) {
      next.pseudo = 'Pseudo requis. Choisissez un pseudo pour rejoindre.'
    }
    return next
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // Validate both fields at once (no sequential back-and-forth).
    const next = validate()
    setErrors(next)
    if (next.pin) {
      pinRef.current?.focus()
      return
    }
    if (next.pseudo) {
      pseudoRef.current?.focus()
      return
    }
    // Nominal path: show a pending → confirmation state (handoff to PlayerLive).
    setStatus('pending')
    window.setTimeout(() => setStatus('joined'), 700)
  }

  if (status === 'joined') {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <div className="join-card join-card--confirm" role="status">
          <h1 ref={welcomeRef} tabIndex={-1}>
            Bienvenue {pseudo.trim()} !
          </h1>
          <p style={{ color: 'var(--ink-dim)' }}>
            Vous avez rejoint la partie. En attente du démarrage — gardez cet écran ouvert.
          </p>
          <PinDisplay pin={mockGamePin} label="Code PIN de la partie" />
        </div>
        <p className="join-tagline">
          Arena — le quiz en direct, open-source. Chez vous ou dans le cloud.
        </p>
      </main>
    )
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />

      {/* No PIN shown here: the player reads it off the big screen. Revealing
          it on the joining device conflicts with the projector's role. */}
      <p style={{ color: 'var(--ink-dim)' }}>
        Saisissez le PIN affiché sur le grand écran pour rejoindre.
      </p>

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1>Rejoindre la partie</h1>

        <div className="join-field">
          <label htmlFor="join-pin">Code PIN</label>
          <input
            id="join-pin"
            ref={pinRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={6}
            placeholder="6 chiffres"
            value={pin}
            onChange={(e) => {
              // Filter in real time: digits only, capped at 6.
              setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
              if (errors.pin) setErrors((prev) => ({ ...prev, pin: undefined }))
            }}
            aria-describedby={errors.pin ? 'join-pin-error' : undefined}
            aria-invalid={errors.pin ? true : undefined}
          />
          {errors.pin && (
            <p className="join-error" id="join-pin-error" role="alert">
              {errors.pin}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="join-pseudo">Pseudo</label>
          <input
            id="join-pseudo"
            ref={pseudoRef}
            type="text"
            autoComplete="off"
            maxLength={20}
            placeholder="Votre pseudo"
            value={pseudo}
            onChange={(e) => {
              setPseudo(e.target.value)
              if (errors.pseudo) setErrors((prev) => ({ ...prev, pseudo: undefined }))
            }}
            aria-describedby={errors.pseudo ? 'join-pseudo-error' : undefined}
            aria-invalid={errors.pseudo ? true : undefined}
          />
          {errors.pseudo && (
            <p className="join-error" id="join-pseudo-error" role="alert">
              {errors.pseudo}
            </p>
          )}
        </div>

        <Button variant="primary" type="submit" disabled={status === 'pending'}>
          {status === 'pending' ? 'Connexion…' : 'Rejoindre'}
        </Button>

        <p className="join-reassure">Aucun compte, aucune installation — juste un pseudo.</p>
      </form>

      <p className="join-tagline">
        Arena — le quiz en direct, open-source. Chez vous ou dans le cloud.
      </p>
    </main>
  )
}
