import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequireAuth } from './RequireAuth'
import { BigScreen } from './screens/BigScreen'
import { HostEditor } from './screens/HostEditor'
import { HostLive } from './screens/HostLive'
import { Join } from './screens/Join'
import { Login } from './screens/Login'
import { PlayerLive } from './screens/PlayerLive'
import { Podium } from './screens/Podium'
import { Signup } from './screens/Signup'

/**
 * Routeur réel remplaçant le sélecteur de démo du prototype.
 *
 * `/` et `/host/:sessionId` sont protégées par <RequireAuth> (redirection
 * vers /login sans session, écran de chargement pendant la résolution — pas
 * de flash du contenu protégé). `/login`, `/signup`, `/join`, `/play` et
 * `/screen/:sessionId` restent publiques : joueurs et grand écran sont
 * anonymes, et il faut pouvoir atteindre login/signup sans session.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      {
        path: '/',
        element: (
          <RequireAuth>
            <HostEditor />
          </RequireAuth>
        ),
      },
      {
        path: '/host/:sessionId',
        element: (
          <RequireAuth>
            <HostLive />
          </RequireAuth>
        ),
      },
      { path: '/join', element: <Join /> },
      { path: '/play', element: <PlayerLive /> },
      { path: '/screen/:sessionId', element: <BigScreen /> },
      { path: '/podium/:sessionId', element: <Podium /> },
    ],
  },
])
