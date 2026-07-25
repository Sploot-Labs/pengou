import { createContext, useContext, type ReactNode } from 'react'
import { useGameSocket, type UseGameSocket } from './useGameSocket'

/**
 * Fournit UNE SEULE instance de socket, partagée par tout le sous-arbre —
 * contrairement à `useGameSocket()` seul, qui ouvre une socket par montage de
 * composant (voir sa doc : c'est le bon défaut pour joueur/écran, qui ont
 * chacun un événement de *reconnexion* dédié — `player:reconnect`,
 * `screen:join` avec un nouveau token).
 *
 * L'hôte n'a PAS d'événement `host:attach`/`host:reconnect` qui rebinderait
 * `socket.data` sur CETTE MÊME socket au fil de la navigation interne
 * (`apps/server/src/game-gateway.ts`, `requireHost` : l'autorité « host »
 * d'une session est posée sur `socket.data` par `host:create` et n'existe que
 * pour CETTE connexion Socket.IO précise). Si `HostEditor` (qui appelle
 * `host:create`) et `HostLive` (qui appelle `host:start`/`reveal`/`next`/
 * `skip`) ouvraient chacun leur propre socket, la navigation de l'un vers
 * l'autre perdrait l'autorité hôte et chaque commande échouerait avec
 * « action réservée à l'hôte de la session ».
 *
 * `<GameSocketProvider>` est donc monté une seule fois, au-dessus d'une route
 * de layout commune à `/` et `/host/:sessionId` (voir `routes.tsx`) — comme
 * `AppShell`/`SessionProvider`, cette route de layout ne remonte que sur un
 * rechargement complet de page, jamais lors d'une navigation gérée par le
 * routeur. Un rechargement complet de `/host/:sessionId` (F5, lien ouvert
 * dans un nouvel onglet, ou reprise d'une partie live depuis `Home`) crée
 * bien une socket NEUVE, sans autorité — mais celle-ci n'est plus perdue pour
 * de bon (Task 8) : `HostLive` appelle `host:reconnect {sessionId}` à son
 * montage quand il n'a pas reçu le PIN via l'état de navigation, et le
 * serveur y rebind `socket.data` + repousse un snapshot de l'état courant
 * (voir `game-gateway.ts`, `emitReconnectSnapshot`).
 */
const GameSocketContext = createContext<UseGameSocket | null>(null)

export function GameSocketProvider({ children }: { children: ReactNode }) {
  const value = useGameSocket()
  return <GameSocketContext.Provider value={value}>{children}</GameSocketContext.Provider>
}

export function useSharedGameSocket(): UseGameSocket {
  const ctx = useContext(GameSocketContext)
  if (!ctx) {
    throw new Error('useSharedGameSocket doit être utilisé sous <GameSocketProvider>')
  }
  return ctx
}
