import type { ReactNode } from 'react'
import { useT } from '../i18n/useT'

/** Lien vers une page hors de l'app, ouvert dans un nouvel onglet. L'ouverture est annoncée dans
 * l'intitulé accessible (texte masqué visuellement), pas seulement suggérée par le contexte. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useT()
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} <span className="visually-hidden">{t("(s'ouvre dans un nouvel onglet)")}</span>
    </a>
  )
}
