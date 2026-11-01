import { useRef, useState, type FormEvent } from 'react'
import { WORDCLOUD_MAX_WORD_LENGTH, WORDCLOUD_MAX_WORDS_PER_PLAYER } from '@splootlabs/quiz'

export interface WordcloudAck {
  accepted: boolean
  reason?: string
  words?: string[]
}

interface PlayerWordcloudProps {
  disabled: boolean
  submit: (word: string) => Promise<WordcloudAck>
}

/**
 * Saisie des idées d'une question nuage de mots : plusieurs envois successifs,
 * la liste affichée est toujours celle de l'acquittement serveur. Après un
 * rechargement, elle se reconstruit au prochain envoi accepté (l'acquittement
 * renvoie la liste complète).
 */
export function PlayerWordcloud({ disabled, submit }: PlayerWordcloudProps) {
  const [value, setValue] = useState('')
  const [words, setWords] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const word = value.trim()
    if (disabled || sending || word.length === 0) return
    setSending(true)
    setError(null)
    try {
      const ack = await submit(word)
      if (ack.accepted) {
        setValue('')
        if (ack.words) setWords(ack.words)
      } else {
        setError(ack.reason ?? 'Idée non prise en compte.')
      }
    } catch (err) {
      setError(err instanceof Error ? `Idée non envoyée (${err.message}).` : 'Idée non envoyée.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="player-wordcloud">
      <form className="player-text" onSubmit={onSubmit}>
        <label htmlFor="player-wordcloud-input" className="visually-hidden">
          Ton idée
        </label>
        <input
          id="player-wordcloud-input"
          ref={inputRef}
          type="text"
          maxLength={WORDCLOUD_MAX_WORD_LENGTH}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Un mot ou deux"
          autoComplete="off"
          aria-describedby="player-wordcloud-help"
        />
        <div className="player-text__row">
          <span id="player-wordcloud-help">
            {`${WORDCLOUD_MAX_WORD_LENGTH} caractères max, jusqu'à ${WORDCLOUD_MAX_WORDS_PER_PLAYER} idées`}
          </span>
        </div>
        <button type="submit" className="player-cta" disabled={disabled || sending || value.trim().length === 0}>
          Envoyer
        </button>
      </form>

      {error && (
        <p className="player-answered" role="alert">
          {error}
        </p>
      )}

      {words.length > 0 && (
        <section aria-labelledby="player-wordcloud-list">
          <h2 id="player-wordcloud-list">Tes idées envoyées</h2>
          <ul>
            {words.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
