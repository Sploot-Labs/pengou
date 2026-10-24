/**
 * Identité de joueur anonyme persistée localement — c'est elle qui permet la
 * reconnexion (`player:reconnect {pin, joinToken}`) après un rechargement de
 * page ou une coupure réseau sur `/play`. Les joueurs n'ont pas de compte
 * (voir Join/PlayerLive) : ce `localStorage` est leur seule « session ».
 */

const STORAGE_KEY = 'pengou.playerSession'

export interface StoredPlayerSession {
  /** Non renvoyé par `player:join` aujourd'hui (voir game-gateway.ts) — gardé
   * optionnel pour ne pas mentir sur ce que le serveur fournit réellement. */
  sessionId?: string
  pin: string
  playerId: string
  joinToken: string
  nickname: string
}

function isStoredPlayerSession(value: unknown): value is StoredPlayerSession {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.pin === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.joinToken === 'string' &&
    typeof v.nickname === 'string'
  )
}

export function savePlayerSession(session: StoredPlayerSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

/** `null` si rien n'est stocké OU si le contenu stocké est corrompu/d'un
 * format inattendu (JSON invalide, champs manquants) — un joueur sans
 * identité valide doit repasser par `/join`, pas planter. */
export function loadPlayerSession(): StoredPlayerSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isStoredPlayerSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearPlayerSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}
