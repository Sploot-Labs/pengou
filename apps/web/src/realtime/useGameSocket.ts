import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { getActiveTenantId } from '../api/activeTenant'

/**
 * Hook socket temps réel partagé par les écrans joueur/hôte/grand écran.
 *
 * Une instance de socket par montage (créée paresseusement au premier rendu,
 * fermée au démontage) — pas de singleton partagé entre écrans. Ça épouse
 * exactement le contrat de reconnexion du serveur (`player:reconnect
 * {pin, joinToken}`) : naviguer de `/join` vers `/play`, ou recharger `/play`,
 * crée une nouvelle socket et l'écran appelant se re-rattache lui-même via
 * son propre appel de reconnexion plutôt que de dépendre d'un socket survivant
 * à la navigation.
 *
 * Même origine : `io()` sans URL résout contre `window.location`, donc le
 * proxy dev (`vite.config.ts`, `/socket.io` → `http://localhost:3000`, `ws:
 * true`) et le déploiement mono-process en prod fonctionnent sans config.
 */

const ACK_TIMEOUT_MS = 8000

/** Ack serveur générique : `{error: string}` sur échec, n'importe quoi d'autre
 * sur succès (chaque event a sa propre forme de succès — voir game-gateway.ts). */
interface ErrorAck {
  error: string
}

function isErrorAck(value: unknown): value is ErrorAck {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

export interface UseGameSocket {
  socket: Socket
  /** `true` une fois la connexion Socket.IO établie (bascule à `false` sur coupure). */
  connected: boolean
  /**
   * Émet un événement ack-style et retourne une promesse : résolue avec l'ack
   * du serveur, rejetée si l'ack est `{error}` OU si aucun ack n'arrive avant
   * `ACK_TIMEOUT_MS` (socket coupée, serveur muet, event mal orthographié…).
   */
  emitAck<T>(event: string, payload?: unknown): Promise<T>
  /** S'abonne à un événement diffusé (`lobby:update`, `question:show`, …).
   * Retourne la fonction de désabonnement — à appeler au nettoyage de l'effet
   * appelant, sinon le composant précédent continuerait à recevoir des events
   * après démontage. */
  on<T = unknown>(event: string, callback: (payload: T) => void): () => void
}

export function useGameSocket(): UseGameSocket {
  // Lazy-init dans une ref : une seule socket par montage du composant, même
  // si celui-ci se re-rend plusieurs fois avant l'effet de connexion.
  const socketRef = useRef<Socket | null>(null)
  if (!socketRef.current) {
    // `autoConnect: false` + un `socket.connect()` explicite dans l'effet
    // ci-dessous (au lieu de laisser `io()` se connecter tout seul à la
    // création) : sous React 18 StrictMode, l'effet de montage est rejoué en
    // double en dev (monte → nettoie → remonte, sans recréer la socket — le
    // `useRef` persiste). Si la socket se connectait toute seule dès sa
    // création, le premier `cleanup` (qui appelle `disconnect()`) la laissait
    // dans un état « déconnectée manuellement » que rien ne relançait ensuite
    // (Socket.IO n'auto-reconnecte jamais après un `disconnect()` explicite) —
    // la socket restait injoignable pour le reste de la vie du composant. En
    // connectant explicitement dans l'effet (rejoué à chaque remontage,
    // simulé ou réel), le second passage relance bien la connexion.
    // Multi-tenant (Slice 3) : le workspace actif voyage dans le handshake (`auth.tenantId`) —
    // l'équivalent WS de l'en-tête `x-tenant-id`. Le serveur le lit dans `host:create`
    // (`socket.handshake.auth.tenantId`). Null en single/anonyme → omis, le serveur retombe sur
    // `default`. Fixé à la création de la socket (une par montage) : basculer de workspace passe
    // par un rechargement (voir le switcher), ce qui recrée la socket avec le bon tenant.
    const tenantId = getActiveTenantId() ?? undefined
    socketRef.current = io({ path: '/socket.io', autoConnect: false, auth: tenantId ? { tenantId } : undefined })
  }
  const socket = socketRef.current

  const [connected, setConnected] = useState(socket.connected)

  useEffect(() => {
    function handleConnect() {
      setConnected(true)
    }
    function handleDisconnect() {
      setConnected(false)
    }
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.connect()
    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une socket par montage : `socket` est stable pour toute la durée de vie du composant.
  }, [])

  const emitAck = useCallback(
    <T,>(event: string, payload?: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        let settled = false
        const timer = window.setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`Le serveur n'a pas répondu à « ${event} » à temps.`))
        }, ACK_TIMEOUT_MS)

        socket.emit(event, payload, (ack: unknown) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          if (isErrorAck(ack)) {
            reject(new Error(ack.error))
            return
          }
          resolve(ack as T)
        })
      }),
    [socket],
  )

  const on = useCallback(
    <T = unknown,>(event: string, callback: (payload: T) => void): (() => void) => {
      socket.on(event, callback)
      return () => {
        socket.off(event, callback)
      }
    },
    [socket],
  )

  return { socket, connected, emitAck, on }
}
