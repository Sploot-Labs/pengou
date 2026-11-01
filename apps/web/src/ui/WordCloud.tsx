/**
 * Nuage de mots : flux centré, cinq paliers de taille proportionnels à la fréquence.
 * Réutilisé par le grand écran (lecture seule) et l'écran hôte (avec retrait d'un mot).
 */

export interface WordCloudWord {
  key: string
  text: string
  count: number
}

export interface WordCloudProps {
  words: WordCloudWord[]
  /** Présent sur l'écran hôte seulement : affiche un bouton de retrait par mot. */
  onRemove?: (word: { key: string; text: string }) => void
  emptyLabel?: string
}

function tier(count: number, maxCount: number): number {
  if (maxCount <= 0) return 1
  return Math.min(5, Math.max(1, Math.ceil((5 * count) / maxCount)))
}

/** Ligne de compteurs sous le nuage (grand écran et écran hôte). */
export function wordcloudSummary(view: { participants: number; totalWords: number; truncated: boolean }): string {
  const who = view.participants === 1 ? '1 participant a proposé' : `${view.participants} participants ont proposé`
  const what = view.totalWords === 1 ? '1 mot reçu' : `${view.totalWords} mots reçus`
  return `${who}, ${what}${view.truncated ? ' (100 mots les plus cités)' : ''}`
}

export function WordCloud({ words, onRemove, emptyLabel = 'En attente des premières idées…' }: WordCloudProps) {
  if (words.length === 0) {
    return <p className="wordcloud__empty">{emptyLabel}</p>
  }
  const maxCount = Math.max(...words.map((w) => w.count))
  return (
    <ul className="wordcloud" aria-label="Nuage de mots">
      {words.map((w) => (
        <li key={w.key} className={`wordcloud__word wordcloud__word--t${tier(w.count, maxCount)}`}>
          <span>{w.text}</span>
          <span className="visually-hidden">{`, ${w.count}`}</span>
          {onRemove && (
            <button
              type="button"
              className="wordcloud__remove"
              aria-label={`Retirer « ${w.text} »`}
              onClick={() => onRemove({ key: w.key, text: w.text })}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
