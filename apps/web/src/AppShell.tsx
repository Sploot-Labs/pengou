import { Outlet } from 'react-router-dom'
import { SessionProvider } from './api/auth'
import { WorkspaceProvider } from './api/workspace-context'
import { useT } from './i18n/useT'
import { MotionProvider } from './motion/index.js'
import { ThemeProvider } from './theme/ThemeProvider'
import { VerifyEmailBanner } from './ui/VerifyEmailBanner'
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
function SkipLink() {
  const { t } = useT()
  return (
    <a className="ab-skip-link" href="#contenu-principal">
      {t('Aller au contenu')}
    </a>
  )
}

export function AppShell() {
  return (
    <SessionProvider>
      <WorkspaceProvider>
        <MotionProvider>
          <ThemeProvider theme="app">
            <div className="prototype-root">
              <SkipLink />
              <VerifyEmailBanner />
              <Outlet />
            </div>
          </ThemeProvider>
        </MotionProvider>
      </WorkspaceProvider>
    </SessionProvider>
  )
}
