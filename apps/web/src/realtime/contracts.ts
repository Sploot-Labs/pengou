/**
 * Contrats temps réel côté client (P1-5) : types des PAYLOADS Socket.IO émis par le serveur,
 * source UNIQUE partagée par les écrans joueur/hôte/grand écran. Avant, chaque écran re-déclarait
 * `RankingEntry` et la vue de lecture à l'identique — une dérive silencieuse était possible (ex.
 * le champ `startedAt` de la phase de lecture, présent sur le fil mais absent de la projection
 * moteur). Centraliser ici évite cette dérive.
 *
 * NB : ce sont les types du FIL (ce que le serveur émet réellement), pas les projections internes
 * du moteur — d'où `startedAt` sur `ReadingView`, ajouté par la passerelle
 * (`game-gateway.ts`, `question:reading`). Un package `@splootlabs/contracts` partagé serveur↔web
 * (typage complet des events Socket.IO) reste un durcissement de suivi (P1-4).
 */

/** Entrée de classement diffusée par `scoreboard` / `podium`. */
export interface RankingEntry {
  playerId: string
  nickname: string
  score: number
}

/** Payload de `question:reading` (phase de lecture) : projection « énoncé seul » du moteur +
 * `startedAt` (horodatage serveur, pour resynchroniser le compte à rebours côté client). */
export interface ReadingView {
  prompt: string
  index: number
  total: number
  readingTime: number
  startedAt: number | null
}
