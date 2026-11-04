/** Masque toute suite de 20 caractères ou plus [A-Za-z0-9_-] (jetons, clés) : 6 premiers caractères puis « … ». */
export function maskTokens(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{20,}/g, (run) => `${run.slice(0, 6)}…`)
}

/** Domaine du destinataire en minuscules, ou « inconnu » si l'adresse est mal formée. */
export function recipientDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return 'inconnu'
  return email.slice(at + 1).trim().toLowerCase()
}
