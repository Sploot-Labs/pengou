import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { WebKey } from '../i18n/catalog'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { useT } from '../i18n/useT'
import { hasAckCode } from '../realtime/ackError'
import { SESSION_FULL_ACK_CODE } from '../realtime/contracts'
import { savePlayerSession } from '../realtime/playerSession'
import { useGameSocket } from '../realtime/useGameSocket'
import { Logo, Mascot } from '../ui'

// Texte local affiché quand le serveur refuse le joueur (code `SESSION_FULL`) : la partie est pleine.
const PARTIE_COMPLETE = 'La partie est complète.'

/** Erreur locale (clé traduite à l'affichage) ou message du serveur (déjà dans sa langue). */
type ErrorText = { key: WebKey } | { text: string }

interface FieldErrors {
  pin?: ErrorText
  pseudo?: ErrorText
  form?: ErrorText
}

interface JoinAck {
  playerId: string
  joinToken: string
}

type Status = 'idle' | 'pending'

export function Join() {
  const navigate = useNavigate()
  const { t, tc } = useT()
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
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  // Arrivée via QR (PIN déjà valide) : le seul geste restant est le pseudo — on
  // y place le focus au montage. Sinon (saisie manuelle), on ne vole pas le
  // focus, le lecteur lit la page depuis le début.
  useEffect(() => {
    if (prefilledPin.length === 6) pseudoRef.current?.focus()
    // Montage uniquement : les paramètres d'URL ne changent pas sous cet écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function showError(error: ErrorText): string {
    return 'key' in error ? t(error.key) : error.text
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    const digitsOnly = pin.replace(/\D/g, '')
    if (digitsOnly.length !== 6) {
      next.pin = { key: 'Le PIN doit comporter exactement 6 chiffres.' }
    }
    if (pseudo.trim().length === 0) {
      next.pseudo = { key: 'Pseudo requis. Choisis un pseudo pour rejoindre.' }
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
      // Partie pleine : le PIN est correct, l'erreur concerne le formulaire et
      // non le champ. On l'annonce et on y place le focus sans toucher au PIN.
      if (hasAckCode(err, SESSION_FULL_ACK_CODE)) {
        setErrors({ form: { key: PARTIE_COMPLETE } })
        // Le paragraphe n'existe qu'après le rendu : focus au prochain tick.
        setTimeout(() => formErrorRef.current?.focus(), 0)
        return
      }
      // The server's own message (e.g. "PIN invalide") — surfaced through the
      // existing textual error UI, on the PIN field since an unknown PIN is
      // by far the most common cause.
      setErrors({
        pin: err instanceof Error ? { text: err.message } : { key: 'Impossible de rejoindre la partie.' },
      })
      pinRef.current?.focus()
    }
  }

  // Reflet visuel du PIN dans les 6 cases (aria-hidden) — la saisie réelle
  // reste le <input> transparent posé par-dessus.
  const pinCells = [0, 1, 2, 3, 4, 5].map((i) => pin[i] ?? '')
  // Le champ PIN est toujours décrit par son aide ; l'éventuel message d'erreur
  // s'ajoute devant (ordre de lecture : erreur puis rappel de l'attendu).
  const pinDescribedBy = [errors.pin ? 'join-pin-error' : null, 'join-pin-aide'].filter(Boolean).join(' ')

  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <div className="join-head">
        <Mascot size={120} />
        <Logo />
        {/* No PIN shown here: the player reads it off the big screen. Revealing
            it on the joining device conflicts with the projector's role. */}
        <p className="join-tagline">{t('Pas de compte. Juste un code et un pseudo.')}</p>
      </div>

      <form className="join-form" onSubmit={handleSubmit} noValidate>
        <div className="join-field">
          <label htmlFor="join-pin">{t('Code banquise')}</label>
          <div className="join-pin">
            {pinCells.map((digit, index) => (
              <span className="join-pin__cell" key={index} aria-hidden="true">
                {digit}
              </span>
            ))}
            <input
              id="join-pin"
              className="join-pin__input"
              ref={pinRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                // Filter in real time: digits only, capped at 6.
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                if (errors.pin) setErrors((prev) => ({ ...prev, pin: undefined }))
              }}
              aria-describedby={pinDescribedBy}
              aria-invalid={errors.pin ? true : undefined}
            />
          </div>
          <span className="join-hint" id="join-pin-aide">
            {t('Les 6 chiffres affichés sur le grand écran.')}
          </span>
          {errors.pin && (
            <p className="join-error" id="join-pin-error" role="alert">
              {showError(errors.pin)}
            </p>
          )}
        </div>

        <div className="join-field">
          <label htmlFor="join-pseudo">{t('Ton pseudo')}</label>
          <input
            id="join-pseudo"
            className="join-pseudo"
            ref={pseudoRef}
            type="text"
            autoComplete="off"
            maxLength={20}
            placeholder={t('ex. Plume')}
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
              {showError(errors.pseudo)}
            </p>
          )}
        </div>

        <div className="join-spacer" />

        {errors.form && (
          <p className="join-error" role="alert" tabIndex={-1} ref={formErrorRef}>
            {showError(errors.form)}
          </p>
        )}

        <button type="submit" className="player-cta" disabled={status === 'pending'}>
          {status === 'pending' ? tc('Connexion…', 'partie') : t('Rejoindre la colonie')}
        </button>
        <p className="join-reassure">{t('Ton pseudo est visible par toute la salle.')}</p>
      </form>
      <LanguageSelect className="join-lang" />
    </main>
  )
}
