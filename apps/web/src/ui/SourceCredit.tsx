import type { ReactNode } from 'react'
import type { ContentSource } from '../api/quizzes'

// Licences connues, avec leur texte officiel. Une chaîne inconnue reste du texte simple.
const LICENSE_URLS: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/deed.fr',
}

/** Page publique des crédits : auteurs, modifications et licence de chaque base. */
export const CREDITS_PATH = '/credits'

// Ancre de la page des crédits pour chaque base du catalogue, reconnue à son adresse.
const CREDIT_ANCHORS: [RegExp, string][] = [
  [/opentdb\.com/i, 'opentdb'],
  [/openquizzdb\.org/i, 'openquizzdb'],
]

// Les packs traduits le signalent dans leur nom : « OpenQuizzDB, Jean Martin (traduction Sploot Labs) ».
const TRANSLATION_SUFFIX = /\s*\(traduction ([^)]+)\)\s*$/

/** Auteur de la traduction, ou `null` quand le contenu est dans sa langue d'origine. */
export function sourceTranslator(source: ContentSource): string | null {
  return TRANSLATION_SUFFIX.exec(source.name)?.[1].trim() ?? null
}

/** Nom complet sans la mention de traduction : « OpenQuizzDB, Jean Martin ». */
function sourceAuthorName(source: ContentSource): string {
  return source.name.replace(TRANSLATION_SUFFIX, '')
}

/** Nom de la base d'origine : « OpenQuizzDB, Jean Martin (traduction …) » devient « OpenQuizzDB ». */
export function sourceBaseName(source: ContentSource): string {
  return sourceAuthorName(source).split(',')[0].trim()
}

/** Lien vers la section de la page des crédits qui détaille cette source, ou vers la page entière. */
export function creditsHref(source: ContentSource | null, section?: string): string {
  const anchor = section ?? CREDIT_ANCHORS.find(([pattern]) => pattern.test(source?.url ?? ''))?.[1]
  return anchor ? `${CREDITS_PATH}#${anchor}` : CREDITS_PATH
}

/** Lien vers la page des crédits, dans un nouvel onglet pour ne pas quitter l'écran en cours. */
function CreditsLink({ href = CREDITS_PATH, children }: { href?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
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

function SourceName({ source, withTranslation = true }: { source: ContentSource; withTranslation?: boolean }) {
  const name = withTranslation ? source.name : sourceAuthorName(source)
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer">
      {name}
    </a>
  ) : (
    name
  )
}

/** Partage à l'identique : les copies modifiées restent sous la même licence. */
function isShareAlike(license: string): boolean {
  return /\bBY-SA\b/i.test(license)
}

/** Étiquettes des cartes de quiz : la base d'origine, et la traduction s'il y en a une. Chacune
 * renvoie à sa section de la page des crédits, qui porte le détail (auteurs, licence). */
export function SourceShort({ source }: { source: ContentSource | null }) {
  if (!source) return null
  const translator = sourceTranslator(source)
  return (
    <span className="source-tags">
      <a className="source-tag" href={creditsHref(source)} target="_blank" rel="noreferrer">
        <span className="visually-hidden">Crédits :</span> {sourceBaseName(source)}
      </a>
      {translator && (
        <a className="source-tag" href={creditsHref(source, 'traductions')} target="_blank" rel="noreferrer">
          Traduit par {translator}
        </a>
      )}
    </span>
  )
}

/** Attribution d'un quiz : « D'après {nom et auteur}, traduit par {…}. Crédits et licence ».
 * Le nom renvoie à l'original ; la licence et les modifications sont sur la page des crédits,
 * ce que CC BY-SA 4.0 admet (attribution par un lien vers une page qui la contient). Rien sans source. */
export function SourceCredit({ source }: { source: ContentSource | null }) {
  if (!source) return null
  const translator = sourceTranslator(source)
  return (
    <span className="source-credit">
      D'après <SourceName source={source} withTranslation={false} />
      {translator && `, traduit par ${translator}`}. <CreditsLink href={creditsHref(source)}>Crédits et licence</CreditsLink>
    </span>
  )
}

/** Note unique sous une liste de questions : bases d'origine, le détail étant sur la page des crédits. */
export function SourcesNote({ sources }: { sources: ContentSource[] }) {
  if (sources.length === 0) return null
  const names = [...new Set(sources.map(sourceBaseName))]
  return (
    <p className="source-credit">
      Questions issues {joinFr(names.map(deName))}. <CreditsLink>Crédits et licences</CreditsLink>
    </p>
  )
}

/** Crédit de fin de partie sur le grand écran : bases d'origine, licence et adresse de la page
 * des crédits écrite en clair, un écran projeté ne se cliquant pas. Rien sans source. */
export function PodiumCredits({ sources }: { sources: ContentSource[] }) {
  if (sources.length === 0) return null
  const names = [...new Set(sources.map(sourceBaseName))]
  const licenses = [...new Set(sources.map((s) => s.license))]
  return (
    <p className="source-credit podium-credits">
      Questions issues {joinFr(names.map(deName))}, licence{licenses.length > 1 ? 's' : ''} {joinFr(licenses)}.
      Crédits : {window.location.host}
      {CREDITS_PATH}
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
        .{licenses.some(isShareAlike) && ' Vos modifications de ces contenus restent sous cette licence.'}{' '}
        <CreditsLink>Crédits et licences</CreditsLink>
      </p>
    </section>
  )
}
