import { useState, type FormEvent } from 'react'
import { mockGamePin } from '../mockData'
import { Button, Logo, PinDisplay } from '../ui'

export function Join() {
  const [pin, setPin] = useState('')
  const [pseudo, setPseudo] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const digitsOnly = pin.replace(/\D/g, '')

    if (digitsOnly.length !== 6) {
      setError('PIN introuvable. Vérifiez les 6 chiffres.')
      return
    }
    if (digitsOnly !== mockGamePin) {
      setError('PIN introuvable. Vérifiez les 6 chiffres.')
      return
    }
    if (pseudo.trim().length === 0) {
      setError('Pseudo requis. Choisissez un pseudo pour rejoindre.')
      return
    }
    setError(null)
    // Prototype only: no navigation to a real game, since there is no backend.
  }

  return (
    <div className="join-screen">
      <Logo />

      <div>
        <p style={{ color: 'var(--ink-dim)', marginBottom: 'var(--space-3)' }}>
          Partie affichée sur l’écran principal
        </p>
        <PinDisplay pin={mockGamePin} label="Code PIN de démonstration" />
      </div>

      <form className="join-card" onSubmit={handleSubmit} noValidate>
        <h1 style={{ fontSize: 'var(--fs-title)' }}>Rejoindre la partie</h1>

        <div className="join-field">
          <label htmlFor="join-pin">Code PIN</label>
          <input
            id="join-pin"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="482913"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            aria-describedby={error ? 'join-error' : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="join-field">
          <label htmlFor="join-pseudo">Pseudo</label>
          <input
            id="join-pseudo"
            type="text"
            autoComplete="off"
            maxLength={20}
            placeholder="Votre pseudo"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
          />
        </div>

        {error && (
          <p className="join-error" id="join-error" role="alert">
            {error}
          </p>
        )}

        <Button variant="primary" type="submit">
          Rejoindre
        </Button>
      </form>
    </div>
  )
}
