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

/** Suffixe `?next=…` à ajouter à un lien vers /login ou /signup (chaîne vide sans destination valide). */
export function nextQuery(next: string | null): string {
  return next ? `?next=${encodeURIComponent(next)}` : ''
}
