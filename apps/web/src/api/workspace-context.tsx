import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useSession } from './auth'
import { setActiveTenantId, getActiveTenantId } from './activeTenant'
import { fetchWorkspaces, type Workspace } from './workspaces'

/**
 * État multi-workspace partagé (Slice 3c). Monté sous `<SessionProvider>` (il lit l'utilisateur
 * courant). Au login, résout `GET /api/workspaces` UNE fois : mémorise le mode de tenancy + la
 * liste, puis choisit le workspace actif (celui persisté en `localStorage` s'il est encore valide,
 * sinon le premier) et le pousse dans le store `activeTenant` (→ en-tête `x-tenant-id` + auth
 * socket). `ready` gate le rendu des écrans protégés en multi : sans workspace actif résolu, une
 * requête de contenu partirait sans `x-tenant-id` et le serveur répondrait 403.
 */

interface WorkspaceContextValue {
  tenancyMode: 'single' | 'multi'
  workspaces: Workspace[]
  activeTenantId: string | null
  active: Workspace | null
  /** true quand la résolution est terminée (ou inutile : pas d'utilisateur). */
  ready: boolean
  /** Sélectionne un workspace : persiste + notifie. Le switcher recharge ensuite pour repartir sur
   * des données/socket propres au nouveau contexte. */
  setActive: (tenantId: string) => void
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const [tenancyMode, setTenancyMode] = useState<'single' | 'multi'>('single')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeTenantId, setActiveState] = useState<string | null>(getActiveTenantId())
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const { tenancyMode: mode, workspaces: list } = await fetchWorkspaces()
    setTenancyMode(mode)
    setWorkspaces(list)
    // Choix du workspace actif : celui persisté s'il fait toujours partie des memberships, sinon
    // le premier. En single, on laisse `null` (le serveur retombe sur `default`).
    const stored = getActiveTenantId()
    const validStored = stored && list.some((w) => w.tenantId === stored) ? stored : null
    const next = mode === 'multi' ? validStored ?? list[0]?.tenantId ?? null : null
    setActiveTenantId(next)
    setActiveState(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!user) {
      // Déconnexion : on oublie tout contexte tenant.
      setActiveTenantId(null)
      setActiveState(null)
      setWorkspaces([])
      setReady(false)
      return
    }
    setReady(false)
    refresh()
      .catch(() => {
        // Échec de résolution (réseau/5xx) : on ne bloque pas indéfiniment l'app — `ready` passe
        // quand même à true, les écrans afficheront leurs propres erreurs de chargement.
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [user, refresh])

  const setActive = useCallback((tenantId: string) => {
    setActiveTenantId(tenantId)
    setActiveState(tenantId)
  }, [])

  const active = workspaces.find((w) => w.tenantId === activeTenantId) ?? null
  const value: WorkspaceContextValue = {
    tenancyMode, workspaces, activeTenantId, active, ready, setActive, refresh,
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaces(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspaces() doit être utilisé sous <WorkspaceProvider> (voir AppShell.tsx)')
  return ctx
}

/** Variante tolérante : renvoie `null` hors provider au lieu de lever. Réservée aux ornements
 * présentationnels optionnels (ex. le switcher d'en-tête, monté par des écrans parfois rendus
 * isolément en test) — les écrans qui DÉPENDENT du contexte utilisent `useWorkspaces`. */
export function useWorkspacesOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}
