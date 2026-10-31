import type { ReactNode } from 'react'
import type { ContentSource } from '../api/quizzes'

// Licences connues, avec leur texte officiel. Une chaîne inconnue reste du texte simple.
const LICENSE_URLS: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/deed.fr',
}

/** Nom de la base d'origine : « OpenQuizzDB, Jean Martin » devient « OpenQuizzDB ». */
export function sourceBaseName(source: ContentSource): string {
  return source.name.split(',')[0].trim()
}

/** « d'OpenQuizzDB », « de Wikipédia » : élision devant une voyelle ou un h. */
function deName(name: string): string {
  return /^[aeiouyhàâéèêëîïôöûü]/i.test(name) ? `d'${name}` : `de ${name}`
}

/** « A », « A et B », « A, B et C ». */
function joinFr(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`
}

function LicenseLink({ license }: { license: string }) {
  const url = LICENSE_URLS[license]
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {license}
    </a>
  ) : (
    license
  )
}

function SourceName({ source }: { source: ContentSource }) {
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer">
      {source.name}
    </a>
  ) : (
    source.name
  )
}

/** Partage à l'identique : les copies modifiées restent sous la même licence. */
function isShareAlike(license: string): boolean {
  return /\bBY-SA\b/i.test(license)
}

/** Mention discrète des cartes de quiz : « D'après OpenQuizzDB ». Le détail est dans l'aperçu. */
export function SourceShort({ source }: { source: ContentSource | null }) {
  if (!source) return null
  return <span className="source-credit">D'après {sourceBaseName(source)}</span>
}

/** Attribution complète : « Source : {nom}, licence {licence} (adapté) ».
 * La licence renvoie à son texte quand elle est connue (CC BY-SA 4.0 impose le lien et la mention
 * de modification, les contenus étant copiés puis modifiables). Rien sans source. */
export function SourceCredit({ source }: { source: ContentSource | null }) {
  if (!source) return null
  return (
    <span className="source-credit">
      Source : <SourceName source={source} />, licence <LicenseLink license={source.license} /> (adapté)
    </span>
  )
}

/** Note unique sous une liste de questions : bases d'origine et licences, sans répéter par question. */
export function SourcesNote({ sources, children }: { sources: ContentSource[]; children?: ReactNode }) {
  if (sources.length === 0) return null
  const names = [...new Set(sources.map(sourceBaseName))]
  const licenses = [...new Set(sources.map((s) => s.license))]
  return (
    <p className="source-credit">
      Questions issues {joinFr(names.map(deName))}, licence{licenses.length > 1 ? 's' : ''}{' '}
      {licenses.map((l, i) => (
        <span key={l}>
          {i > 0 && (i === licenses.length - 1 ? ' et ' : ', ')}
          <LicenseLink license={l} />
        </span>
      ))}
      , adaptées pour Pengou.{children ? ' ' : ''}
      {children}
    </p>
  )
}

/** « 3 », « 1 à 12 », « 1 à 4, 7 et 9 » : numéros (base 1) regroupés en plages. */
function formatPositions(positions: number[]): string {
  const ranges: string[] = []
  let start = positions[0]
  let prev = positions[0]
  for (const n of [...positions.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n
      continue
    }
    ranges.push(start === prev ? String(start) : `${start} à ${prev}`)
    start = n
    prev = n
  }
  return joinFr(ranges)
}

/**
 * Encadré « Sources et licences » de l'éditeur : une ligne par source avec les questions qui en
 * viennent, puis les licences. Rien quand aucun contenu ne vient de la bibliothèque.
 */
export function SourcesPanel({
  quizSource,
  questionSources,
}: {
  quizSource: ContentSource | null
  questionSources: (ContentSource | null)[]
}) {
  const groups = new Map<string, { source: ContentSource; positions: number[] }>()
  questionSources.forEach((source, index) => {
    if (!source) return
    const key = JSON.stringify([source.name, source.url ?? '', source.license])
    const group = groups.get(key) ?? { source, positions: [] }
    group.positions.push(index + 1)
    groups.set(key, group)
  })
  const sourced = [...groups.values()]
  if (!quizSource && sourced.length === 0) return null
  const licenses = [...new Set([quizSource, ...sourced.map((g) => g.source)].filter((s) => s !== null).map((s) => s.license))]
  const total = questionSources.length

  return (
    <section className="sources-panel" aria-labelledby="sources-panel-title">
      <h2 id="sources-panel-title">Sources et licences</h2>
      {quizSource && sourced.length === 0 && (
        <p>
          Quiz d'origine : <SourceName source={quizSource} />.
        </p>
      )}
      {sourced.map(({ source, positions }) => (
        <p key={`${source.name}|${source.url ?? ''}|${source.license}`}>
          {positions.length === total
            ? 'Toutes les questions'
            : `Question${positions.length > 1 ? 's' : ''} ${formatPositions(positions)}`}{' '}
          : <SourceName source={source} />.
        </p>
      ))}
      <p>
        Licence{licenses.length > 1 ? 's' : ''}{' '}
        {licenses.map((l, i) => (
          <span key={l}>
            {i > 0 && (i === licenses.length - 1 ? ' et ' : ', ')}
            <LicenseLink license={l} />
          </span>
        ))}
        , contenus adaptés.
        {licenses.some(isShareAlike) && ' Vos modifications de ces contenus restent sous cette licence.'}
      </p>
    </section>
  )
}
