/**
 * Petit store du « workspace actif » — le pivot du multi-tenant côté client (Slice 3c).
 *
 * Volontairement HORS de React : il est lu à la fois par `client.ts` (en-tête `x-tenant-id` sur
 * chaque requête HTTP) et par la socket (`io({ auth: { tenantId } })`), qui ne sont pas des
 * composants. `WorkspaceProvider` (React) est la façade : il choisit/valide le tenant actif et le
 * pousse ici via `setActiveTenantId`. La source de vérité par requête reste donc cet en-tête, pas
 * l'état React. Persisté en `localStorage` pour survivre à un rechargement.
 */

const STORAGE_KEY = 'arena.activeTenantId'

function readInitial(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // localStorage indisponible (SSR, mode privé strict) → pas de tenant persistant.
    return null
  }
}

let current: string | null = readInitial()
const listeners = new Set<() => void>()

/** Tenant actif, ou null (mode single, non authentifié, ou avant résolution). */
export function getActiveTenantId(): string | null {
  return current
}

/** Définit le tenant actif (et le persiste). Notifie les abonnés (le switcher, `useSyncExternalStore`). */
export function setActiveTenantId(id: string | null): void {
  if (id === current) return
  current = id
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Écriture best-effort : l'en-tête reste correct en mémoire même si la persistance échoue.
  }
  for (const l of listeners) l()
}

export function subscribeActiveTenant(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
