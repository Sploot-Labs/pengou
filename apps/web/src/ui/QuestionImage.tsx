import { useState } from 'react'

export interface QuestionImageProps {
  src?: string | null
  alt?: string | null
  variant: 'big' | 'host' | 'player'
}

/** Image facultative d'une question. Ne rend rien sans `src`, et disparaît si
 * elle ne charge pas (jamais d'icône d'image cassée). L'état d'erreur n'est pas
 * réinitialisé ici : l'appelant passe `key={src}` pour repartir à neuf quand
 * l'URL change. */
export function QuestionImage({ src, alt, variant }: QuestionImageProps) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      className={`question-image question-image--${variant}`}
      src={src}
      alt={alt ?? ''}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
