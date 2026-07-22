import { useRef, useState, type FormEvent } from 'react'
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
      <div className="join-screen">
        <Logo />
        <div className="join-card join-card--confirm" role="status">
          <h1 style={{ fontSize: 'var(--fs-title)' }}>Bienvenue {pseudo.trim()} !</h1>
          <p style={{ color: 'var(--ink-dim)' }}>
            Vous avez rejoint la partie. En attente du démarrage — gardez cet écran ouvert.
          </p>
          <PinDisplay pin={mockGamePin} label="Code PIN de la partie" />
        </div>
        <p className="join-tagline">Arena — quiz en direct, open-source, hébergé chez vous.</p>
      </div>
    )
  }

  return (
    <div className="join-screen">
      <Logo />

      <div>
        <p style={{ color: 'var(--ink-dim)', marginBottom: 'var(--space-3)' }}>
          Saisissez le PIN affiché à l’écran pour rejoindre.
        </p>
        <PinDisplay pin={mockGamePin} label="Code PIN de la partie" />
      </div>

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1 style={{ fontSize: 'var(--fs-title)' }}>Rejoindre la partie</h1>

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
            placeholder="482913"
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
      </form>

      <p className="join-tagline">Arena — quiz en direct, open-source, hébergé chez vous.</p>
    </div>
  )
}
