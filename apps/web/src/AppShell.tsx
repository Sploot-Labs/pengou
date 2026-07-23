import { Outlet } from 'react-router-dom'
import { SessionProvider } from './api/auth'
import './tokens.css'
import './prototype.css'

/**
 * Coquille commune à toutes les routes : héberge le lien d'évitement RGAA
 * (`.ab-skip-link` → `#contenu-principal`, cible fournie par le `<main>` de
 * chaque écran) et le conteneur `.prototype-root` (nécessaire au
 * `prefers-reduced-motion` scoping dans prototype.css). C'est l'ex-shell de
 * `Prototype.tsx` (le sélecteur de démo lui-même a été supprimé).
 *
 * `<SessionProvider>` est monté ICI (une seule fois, au-dessus de toutes les
 * routes via `<Outlet>`) plutôt que dans chaque écran protégé — sans ça,
 * `/` et `/host/:sessionId` referaient chacun leur propre `GET /api/me` à
 * chaque navigation entre routes protégées, avec un flash de l'interstitiel
 * de chargement à chaque fois (cf. RequireAuth). `AppShell` ne remonte que
 * sur un rechargement complet de page, jamais lors d'une navigation gérée
 * par le routeur — la session survit donc à `/` → `/host/:id`.
 */
export function AppShell() {
  return (
    <SessionProvider>
      <div className="prototype-root">
        <a className="ab-skip-link" href="#contenu-principal">
          Aller au contenu
        </a>
        <Outlet />
      </div>
    </SessionProvider>
  )
}
