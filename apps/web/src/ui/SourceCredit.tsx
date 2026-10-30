import type { ContentSource } from '../api/quizzes'

// Licences connues, avec leur texte officiel. Une chaîne inconnue reste du texte simple.
const LICENSE_URLS: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/deed.fr',
}

/** Attribution d'un contenu de la bibliothèque : « Source : {nom}, licence {licence} (adapté) ».
 * La licence renvoie à son texte quand elle est connue (CC BY-SA 4.0 impose le lien et la mention
 * de modification, les contenus étant copiés puis modifiables). Rien sans source. */
export function SourceCredit({ source }: { source: ContentSource | null }) {
  if (!source) return null
  const licenseUrl = LICENSE_URLS[source.license]
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
      , licence{' '}
      {licenseUrl ? (
        <a href={licenseUrl} target="_blank" rel="noreferrer">
          {source.license}
        </a>
      ) : (
        source.license
      )}{' '}
      (adapté)
    </span>
  )
}
