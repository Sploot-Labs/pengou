import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSharedGameSocket } from './GameSocketProvider'
import { PAGE_LOAD_ID } from './pageLoad'

/** Ack de succès de `host:create` — voir `apps/server/src/game-gateway.ts`. Déclaré ICI et
 * réexporté plutôt que dupliqué dans chaque appelant (`HostEditor`, `Home`) : une seule forme,
 * qui ne peut pas dériver entre les deux. */
export interface HostCreateAck {
  sessionId: string
  pin: string
}

export interface UseLaunchGame {
  /**
   * `host:create {quizId}` sur la socket PARTAGÉE (voir `GameSocketProvider` — c'est cette
   * connexion précise qui devient « hôte » de la session côté serveur, et `HostLive` doit donc
   * réutiliser exactement la même socket), puis navigation vers `/host/:sessionId`. Le PIN et le
   * titre ne sont connus qu'ICI (`host:create` ne les redonne jamais ensuite) — transmis à
   * `HostLive` via l'état de navigation plutôt que par l'URL (le PIN n'a rien à faire dans un lien
   * partageable de la page hôte).
   *
   * Ne fait PAS de flush d'édition en attente — c'est spécifique à l'éditeur
   * (`HostEditor.flushPendingSave`, qui doit s'exécuter et réussir AVANT d'appeler `launch`,
   * puisque `host:create` lit les questions directement en base). Un appelant sans état
   * d'édition local (`Home`) peut appeler `launch` directement.
   *
   * Sur échec, l'erreur est à la fois posée dans `error` (pour un appelant qui se contente de
   * lire l'état du hook, comme `Home`) ET relancée (pour un appelant qui a besoin de réagir au
   * résultat précis de CET appel, comme `HostEditor`, qui a son propre état `launching`/erreur à
   * mettre à jour en synchronisation avec sa phase de flush).
   */
  launch(quizId: string, quizTitle: string): Promise<void>
  launching: boolean
  error: string | null
}

/**
 * Hook partagé pour lancer une partie depuis n'importe quel écran monté sous
 * `HostRealtimeLayout` (voir `routes.tsx`) — `HostEditor` (bouton « Lancer la partie ») et `Home`
 * (bouton « Lancer » sur chaque carte de quiz) l'utilisent tous deux, sur la même socket
 * partagée (`useSharedGameSocket`), évitant de dupliquer l'`emitAck('host:create', …)` suivi de
 * la navigation vers `/host/:sessionId` dans les deux écrans.
 */
export function useLaunchGame(): UseLaunchGame {
  const navigate = useNavigate()
  const { emitAck } = useSharedGameSocket()
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const launch = useCallback(
    async (quizId: string, quizTitle: string) => {
      setLaunching(true)
      setError(null)
      try {
        const ack = await emitAck<HostCreateAck>('host:create', { quizId })
        // `launch` date cet état : il ne vaut que pour ce chargement de page (voir `pageLoad.ts`).
        navigate(`/host/${ack.sessionId}`, { state: { pin: ack.pin, quizTitle, launch: PAGE_LOAD_ID } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Impossible de lancer la partie.'
        setLaunching(false)
        setError(message)
        throw new Error(message)
      }
    },
    [emitAck, navigate],
  )

  return { launch, launching, error }
}
