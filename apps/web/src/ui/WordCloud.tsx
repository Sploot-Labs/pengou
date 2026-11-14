/**
 * Nuage de mots : flux centré, cinq paliers de taille proportionnels à la fréquence.
 * Réutilisé par le grand écran (lecture seule) et l'écran hôte (avec retrait d'un mot).
 */

import { formatNumber, t } from '../i18n/t'
import { useT } from '../i18n/useT'

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
  // Singulier seulement à 1 : à zéro, le texte français d'origine garde le pluriel.
  const who =
    view.participants === 1
      ? t('{n} participant a proposé', { n: formatNumber(1) })
      : t('{n} participants ont proposé', { n: formatNumber(view.participants) })
  const what =
    view.totalWords === 1
      ? t('{n} mot reçu', { n: formatNumber(1) })
      : t('{n} mots reçus', { n: formatNumber(view.totalWords) })
  return `${who}, ${what}${view.truncated ? ` ${t('(100 mots les plus cités)')}` : ''}`
}

export function WordCloud({ words, onRemove, emptyLabel }: WordCloudProps) {
  const { t } = useT()
  if (words.length === 0) {
    return <p className="wordcloud__empty">{emptyLabel ?? t('En attente des premières idées…')}</p>
  }
  const maxCount = Math.max(...words.map((w) => w.count))
  return (
    <ul className="wordcloud" aria-label={t('Nuage de mots')}>
      {words.map((w) => (
        <li key={w.key} className={`wordcloud__word wordcloud__word--t${tier(w.count, maxCount)}`}>
          <span>{w.text}</span>
          <span className="visually-hidden">{`, ${w.count}`}</span>
          {onRemove && (
            <button
              type="button"
              className="wordcloud__remove"
              aria-label={t('Retirer « {word} »', { word: w.text })}
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
