import { Link } from 'react-router-dom'
import { useWorkspacesOptional } from '../api/workspace-context'

const ROLE_LABEL: Record<string, string> = { owner: 'propriétaire', admin: 'admin', member: 'membre' }

/**
 * Sélecteur de workspace (Slice 3c) — rendu dans l'en-tête, UNIQUEMENT en mode multi (en single il
 * n'y a qu'un tenant, aucun choix à offrir → `null`). Basculer déclenche un rechargement vers
 * l'accueil : le nouveau contexte veut des données ET une socket propres (l'ancienne socket porte
 * l'ancien `auth.tenantId`, et la liste de quiz/parties appartient à l'ancien workspace).
 */
export function WorkspaceSwitcher() {
  const ctx = useWorkspacesOptional()
  // Hors provider (écran rendu isolément en test) ou en mode single : rien à afficher.
  if (!ctx || ctx.tenancyMode !== 'multi') return null
  const { workspaces, activeTenantId, setActive } = ctx

  if (workspaces.length === 0) {
    return (
      <Link className="ab-button ab-button--ghost" to="/workspace">
        Créer un workspace
      </Link>
    )
  }

  return (
    <div className="ab-workspace-switcher" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <label htmlFor="ws-switch" className="visually-hidden">Workspace actif</label>
      <select
        id="ws-switch"
        className="ab-workspace-switcher__select"
        value={activeTenantId ?? ''}
        onChange={(e) => {
          const id = e.target.value
          if (id && id !== activeTenantId) {
            setActive(id)
            // Rechargement dur : repart sur des données + une socket alignées au nouveau workspace.
            window.location.assign('/')
          }
        }}
      >
        {workspaces.map((w) => (
          <option key={w.tenantId} value={w.tenantId}>
            {w.name}
            {w.role !== 'member' ? ` · ${ROLE_LABEL[w.role]}` : ''}
          </option>
        ))}
      </select>
      <Link className="ab-button ab-button--ghost" to="/workspace">Gérer</Link>
    </div>
  )
}
