/**
 * Destination de retour après connexion ou inscription (`?next=/invitations/abc?v=xyz`).
 * Seuls les chemins relatifs du même site sont acceptés : commence par `/`, ni `//` ni `/\`
 * (URL relative au protocole), aucun caractère de contrôle. Tout le reste est ignoré (anti redirection ouverte).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw?.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  return raw
}

/**
 * Suffixe `?next=…&from=…` à ajouter à un lien vers /login ou /signup (chaîne vide sans destination
 * ni provenance). `from` est la provenance d'inscription posée par le site vitrine : elle suit le
 * visiteur qui passe de l'inscription à la connexion et revient.
 */
export function nextQuery(next: string | null, from?: string | null): string {
  const params = [
    ...(next ? [`next=${encodeURIComponent(next)}`] : []),
    ...(from ? [`from=${encodeURIComponent(from)}`] : []),
  ]
  return params.length ? `?${params.join('&')}` : ''
}
