import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
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
 * `/` et `/host/:sessionId` seront protégées par <RequireAuth> à la Task 2
 * (redirection vers /login sans session) — pour l'instant elles rendent
 * l'écran directement, toujours piloté par mockData (câblage réel : Tasks 3-5).
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      { path: '/', element: <HostEditor /> },
      { path: '/host/:sessionId', element: <HostLive /> },
      { path: '/join', element: <Join /> },
      { path: '/play', element: <PlayerLive /> },
      { path: '/screen/:sessionId', element: <BigScreen /> },
      { path: '/podium/:sessionId', element: <Podium /> },
    ],
  },
])
