import type { ContentSource } from '../api/quizzes'

/** Attribution d'un contenu de la bibliothèque : « Source : {nom}, licence {licence} ». Rien sans source. */
export function SourceCredit({ source }: { source: ContentSource | null }) {
  if (!source) return null
  return (
    <span className="source-credit">
      Source :{' '}
      {source.url ? (
        <a href={source.url} target="_blank" rel="noreferrer">
          {source.name}
        </a>
      ) : (
        source.name
      )}
      , licence {source.license}
    </span>
  )
}
