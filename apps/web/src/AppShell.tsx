import { Outlet } from 'react-router-dom'
import './tokens.css'
import './prototype.css'

/**
 * Coquille commune à toutes les routes : héberge le lien d'évitement RGAA
 * (`.ab-skip-link` → `#contenu-principal`, cible fournie par le `<main>` de
 * chaque écran) et le conteneur `.prototype-root` (nécessaire au
 * `prefers-reduced-motion` scoping dans prototype.css). C'est l'ex-shell de
 * `Prototype.tsx` (le sélecteur de démo lui-même a été supprimé).
 */
export function AppShell() {
  return (
    <div className="prototype-root">
      <a className="ab-skip-link" href="#contenu-principal">
        Aller au contenu
      </a>
      <Outlet />
    </div>
  )
}
