import type { ReactNode } from 'react'

/** Lien vers une page hors de l'app, ouvert dans un nouvel onglet. L'ouverture est annoncée dans
 * l'intitulé accessible (texte masqué visuellement), pas seulement suggérée par le contexte. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}{' '}
      <span className="visually-hidden">(s'ouvre dans un nouvel onglet)</span>
    </a>
  )
}
