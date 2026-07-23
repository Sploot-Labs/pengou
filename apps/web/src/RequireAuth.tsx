import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from './api/auth'
import { Logo } from './ui'

/**
 * Route guard for protected screens (`/`, `/host/:sessionId`). Three states,
 * rendered exclusively — never protected content before the session probe
 * resolves:
 *  - `loading`: on-brand loading panel (no flash of the real screen).
 *  - resolved, no user: redirect to `/login` (`replace` so the guarded route
 *    doesn't linger in history — no back-button bounce into a redirect loop).
 *  - resolved, user present: render the children.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession()

  if (loading) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Vérification de la session…</p>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
