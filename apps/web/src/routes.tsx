import { createBrowserRouter, Outlet } from 'react-router-dom'
import { AppShell } from './AppShell'
import { GameSocketProvider } from './realtime/GameSocketProvider'
import { RequireAuth } from './RequireAuth'
import { BigScreen } from './screens/BigScreen'
import { HostEditor } from './screens/HostEditor'
import { HostLive } from './screens/HostLive'
import { Join } from './screens/Join'
import { Login } from './screens/Login'
import { PlayerLive } from './screens/PlayerLive'
import { Signup } from './screens/Signup'

/**
 * Route de layout (sans `path` propre) partagée par `/` et `/host/:sessionId` :
 * monte UNE SEULE `<GameSocketProvider>` au-dessus des deux, pour que la
 * socket qui appelle `host:create` (HostEditor) soit la MÊME que celle qui
 * appelle ensuite `host:start`/`reveal`/`next`/`skip` (HostLive) — voir la
 * doc de `GameSocketProvider` pour pourquoi c'est requis (pas de
 * `host:reconnect` côté serveur). Ne remonte pas lors d'une navigation
 * `/` → `/host/:id` gérée par le routeur (seul un rechargement complet de
 * page le ferait).
 */
function HostRealtimeLayout() {
  return (
    <GameSocketProvider>
      <Outlet />
    </GameSocketProvider>
  )
}

/**
 * Routeur réel remplaçant le sélecteur de démo du prototype.
 *
 * `/` et `/host/:sessionId` sont protégées par <RequireAuth> (redirection
 * vers /login sans session, écran de chargement pendant la résolution — pas
 * de flash du contenu protégé). `/login`, `/signup`, `/join`, `/play` et
 * `/screen/:sessionId` restent publiques : joueurs et grand écran sont
 * anonymes, et il faut pouvoir atteindre login/signup sans session.
 *
 * Pas de route `/podium/:sessionId` : l'événement `podium` n'est diffusé
 * qu'aux sockets déjà membres de la room de session (hôte ou grand écran —
 * voir `game-gateway.ts`), et le contrat ne définit aucun rôle
 * « spectateur » capable de rejoindre cette room à froid. Un montage
 * autonome de cette route n'aurait donc aucune source de données réelle. Le
 * podium est rendu comme une phase de plus, inline, dans `HostLive` et
 * `BigScreen` (qui sont déjà dans la room et reçoivent l'événement) — voir
 * `screens/Podium.tsx`, qui exporte désormais `PodiumView`, un composant de
 * présentation réutilisé par les deux.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      {
        element: <HostRealtimeLayout />,
        children: [
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
        ],
      },
      { path: '/join', element: <Join /> },
      { path: '/play', element: <PlayerLive /> },
      { path: '/screen/:sessionId', element: <BigScreen /> },
    ],
  },
])
