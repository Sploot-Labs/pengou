import { createBrowserRouter, Outlet } from 'react-router-dom'
import { AppShell } from './AppShell'
import { GameSocketProvider } from './realtime/GameSocketProvider'
import { RequireAuth } from './RequireAuth'
import { BigScreen } from './screens/BigScreen'
import { Home } from './screens/Home'
import { HostEditor } from './screens/HostEditor'
import { HostLive } from './screens/HostLive'
import { Join } from './screens/Join'
import { Login } from './screens/Login'
import { PlayerLive } from './screens/PlayerLive'
import { Signup } from './screens/Signup'

/**
 * Route de layout (sans `path` propre) partagée par `/`, `/quizzes/:quizId`
 * et `/host/:sessionId` : monte UNE SEULE `<GameSocketProvider>` au-dessus
 * des trois, pour que la socket qui appelle `host:create` (HostEditor, sur
 * `/quizzes/:quizId`) soit la MÊME que celle qui appelle ensuite
 * `host:start`/`reveal`/`next`/`skip` (HostLive) — voir la doc de
 * `GameSocketProvider` pour pourquoi c'est requis (pas de `host:reconnect`
 * côté serveur). Ne remonte pas lors d'une navigation
 * `/` → `/quizzes/:id` → `/host/:id` gérée par le routeur (seul un
 * rechargement complet de page le ferait).
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
 * `/`, `/quizzes/:quizId` et `/host/:sessionId` sont protégées par
 * <RequireAuth> (redirection vers /login sans session, écran de chargement
 * pendant la résolution — pas de flash du contenu protégé). `/login`,
 * `/signup`, `/join`, `/play` et `/screen/:sessionId` restent publiques :
 * joueurs et grand écran sont anonymes, et il faut pouvoir atteindre
 * login/signup sans session.
 *
 * Plan 07 Task 4 : `/` héberge désormais l'accueil hôte (`Home` — liste des
 * quiz + parties récentes) et l'éditeur a déménagé sur `/quizzes/:quizId`
 * (il lit l'id du quiz depuis l'URL au lieu de son ancien état de sélection
 * interne — voir `HostEditor.tsx`). `/sessions/:sessionId` (le rapport de
 * partie, Task 5) n'est PAS encore montée ici : `Home` construit déjà les
 * liens vers cette route (`react-router` ne résout les liens qu'à la
 * navigation, jamais au rendu — un lien vers une route pas encore montée ne
 * casse donc rien tant que personne ne clique dessus avant Task 5).
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
                <Home />
              </RequireAuth>
            ),
          },
          {
            path: '/quizzes/:quizId',
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
