import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { savePlayerSession } from '../realtime/playerSession'
import { useGameSocket } from '../realtime/useGameSocket'
import { Button, Logo, Mascot } from '../ui'

interface FieldErrors {
  pin?: string
  pseudo?: string
}

interface JoinAck {
  playerId: string
  joinToken: string
}

type Status = 'idle' | 'pending'

export function Join() {
  const navigate = useNavigate()
  const { emitAck } = useGameSocket()
  const [searchParams] = useSearchParams()

  // PIN prérempli depuis l'URL (QR du grand écran : `/join?pin=…`) — filtré aux
  // mêmes règles que la saisie manuelle (6 chiffres max) pour qu'un paramètre
  // douteux ne contourne pas la validation. Le champ reste éditable.
  const prefilledPin = (searchParams.get('pin') ?? '').replace(/\D/g, '').slice(0, 6)

  const [pin, setPin] = useState(prefilledPin)
  const [pseudo, setPseudo] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<Status>('idle')
  const pinRef = useRef<HTMLInputElement>(null)
  const pseudoRef = useRef<HTMLInputElement>(null)

  // Arrivée via QR (PIN déjà valide) : le seul geste restant est le pseudo — on
  // y place le focus au montage. Sinon (saisie manuelle), on ne vole pas le
  // focus, le lecteur lit la page depuis le début.
  useEffect(() => {
    if (prefilledPin.length === 6) pseudoRef.current?.focus()
    // Montage uniquement : les paramètres d'URL ne changent pas sous cet écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    const digitsOnly = pin.replace(/\D/g, '')
    if (digitsOnly.length !== 6) {
      next.pin = 'Le PIN doit comporter exactement 6 chiffres.'
    }
    if (pseudo.trim().length === 0) {
      next.pseudo = 'Pseudo requis. Choisis un pseudo pour rejoindre.'
    }
    return next
  }

  async function handleSubmit(event: FormEvent) {
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

    setStatus('pending')
    try {
      const trimmedPseudo = pseudo.trim()
      const ack = await emitAck<JoinAck>('player:join', { pin, nickname: trimmedPseudo })
      savePlayerSession({
        pin,
        playerId: ack.playerId,
        joinToken: ack.joinToken,
        nickname: trimmedPseudo,
      })
      navigate('/play')
    } catch (err) {
      setStatus('idle')
      // The server's own message (e.g. "PIN invalide") — surfaced through the
      // existing textual error UI, on the PIN field since an unknown PIN is
      // by far the most common cause.
      setErrors({
        pin: err instanceof Error ? err.message : 'Impossible de rejoindre la partie.',
      })
      pinRef.current?.focus()
    }
  }

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Mascot size={140} />
      <Logo />

      {/* No PIN shown here: the player reads it off the big screen. Revealing
          it on the joining device conflicts with the projector's role. */}
      <p style={{ color: 'var(--ink-dim)' }}>
        Saisis le code banquise affiché sur le grand écran pour rejoindre la colonie.
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
            placeholder="Ton pseudo"
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

        <p className="join-reassure">Aucun compte, aucune installation, juste un pseudo.</p>
      </form>

      <p className="join-tagline">
        Pingou : le quiz en direct, open-source. Chez vous ou dans le cloud.
      </p>
    </main>
  )
}
