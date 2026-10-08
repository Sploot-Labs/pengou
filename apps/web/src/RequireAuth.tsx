import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from './api/auth'
import { useWorkspaces } from './api/workspace-context'
import { Button, Logo } from './ui'

/**
 * Route guard for protected screens (`/`, `/host/:sessionId`). Four states,
 * rendered exclusively — never protected content before the session probe
 * resolves:
 *  - `loading`: on-brand loading panel (no flash of the real screen).
 *  - resolved, TRANSIENT error (5xx/network — see `useSession`'s `error`,
 *    which `fetchSession` only ever sets for a NON-401 failure): an on-brand
 *    retry panel, never a redirect. A 401 (clean "no session") never reaches
 *    here — `fetchSession` resolves it to `user: null` with no `error` — so
 *    this branch fires only for a probe that genuinely couldn't be answered,
 *    which used to silently log the host out of a session that may still be
 *    perfectly valid (Plan 06 review finding #7).
 *  - resolved, no error, no user: redirect to `/login` (`replace` so the
 *    guarded route doesn't linger in history — no back-button bounce into a
 *    redirect loop).
 *  - resolved, user present: render the children.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, refresh } = useSession()

  if (loading) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Vérification de la session…</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          Impossible de vérifier votre session (problème réseau ou serveur temporairement
          indisponible). Vous n'avez pas été déconnecté, réessayez.
        </p>
        <Button variant="primary" type="button" onClick={() => void refresh()}>
          Réessayer
        </Button>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <WorkspaceGate>{children}</WorkspaceGate>
}

/**
 * Attend la résolution du workspace actif avant de rendre un écran protégé. En multi, un écran de
 * contenu monté trop tôt lancerait ses requêtes SANS `x-tenant-id` (workspace pas encore choisi) →
 * 403. On patiente donc sur `ready`. En single, `ready` bascule tout aussi vite (résolution triviale)
 * sans exiger de workspace actif.
 */
function WorkspaceGate({ children }: { children: ReactNode }) {
  const { ready } = useWorkspaces()
  if (!ready) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Chargement de votre espace…</p>
      </main>
    )
  }
  return <>{children}</>
}
