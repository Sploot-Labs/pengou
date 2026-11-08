/** Domaines courants en France, pour l'aide à la saisie. */
const COMMON_DOMAINS = [
  'gmail.com',
  'outlook.fr',
  'outlook.com',
  'hotmail.fr',
  'hotmail.com',
  'live.fr',
  'yahoo.fr',
  'yahoo.com',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'icloud.com',
  'protonmail.com',
  'proton.me',
]

const MAX_DISTANCE = 2

/** Fautes d'extension fréquentes, corrigées avant la comparaison. */
const EXTENSION_FIXES: [RegExp, string][] = [
  [/\.(con|cm|cmo|ocm)$/, '.com'],
  [/\.+$/, ''],
]

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = row
  }
  return prev[b.length]
}

function closestCommonDomain(domain: string): string | null {
  let best: string | null = null
  let bestDistance = MAX_DISTANCE + 1
  for (const candidate of COMMON_DOMAINS) {
    const d = levenshtein(domain, candidate)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  return best
}

/**
 * Propose l'adresse corrigée quand le domaine ressemble à un domaine courant mal saisi,
 * sinon null. Pure et sans dépendance Node (utilisée par le web). La partie locale n'est
 * jamais modifiée.
 */
export function suggestEmailDomain(email: string): string | null {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at < 1 || at === trimmed.length - 1) return null
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1).toLowerCase()
  if (COMMON_DOMAINS.includes(domain)) return null

  let fixed = domain
  for (const [pattern, replacement] of EXTENSION_FIXES) fixed = fixed.replace(pattern, replacement)

  const match = COMMON_DOMAINS.includes(fixed) ? fixed : closestCommonDomain(fixed)
  const suggestion = match ?? (fixed !== domain && fixed.includes('.') ? fixed : null)
  return suggestion ? `${local}@${suggestion}` : null
}
