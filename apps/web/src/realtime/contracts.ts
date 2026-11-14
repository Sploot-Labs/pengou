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

import type { ContentSource } from '../api/quizzes'

/** Payload de `podium` : les trois premiers, et les sources des questions pour le crédit de fin
 * de partie (vide pour un quiz écrit à la main). */
export interface PodiumPayload {
  top: RankingEntry[]
  /** Classement complet calculé par le moteur, donc sans joueur exclu (contrairement au dernier
   * `scoreboard`, qui peut en contenir un). Absent sur un serveur antérieur : les écrans retombent
   * alors sur le dernier `scoreboard`. */
  ranking?: RankingEntry[]
  sources: ContentSource[]
  /** Faux quand le quiz ne contient aucune question notée (`top` est alors vide). */
  hasScoredQuestions: boolean
}

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
  media?: string | null
  mediaAlt?: string | null
}

/** Payload de `auto:advance` (enchaînement automatique des étapes) : horodatage serveur (ms epoch)
 * de la bascule planifiée vers l'étape suivante, pour le compte à rebours CLIENT — même esprit que
 * le `startedAt` du chrono (le serveur est seul maître de la bascule, le client ne fait que la
 * refléter). `nextAt: null` annule le compte à rebours (mode auto désactivé par l'hôte). */
export interface AutoAdvanceView {
  nextAt: number | null
}

/** Payload de `wordcloud:update` (grand écran et hôte seulement, jamais les téléphones) : mots
 * fusionnés par clé de normalisation, triés côté serveur. Copie de `WordcloudView` du moteur. */
export interface WordcloudView {
  questionId: string
  words: { key: string; text: string; count: number }[]
  participants: number
  totalWords: number
  truncated: boolean
}

/** Champ `poll` de `question:reveal` pour un sondage (grand écran et hôte) : votes par option,
 * dans l'ordre des choix, et nombre de joueurs ayant voté (base du pourcentage). Copie de la
 * `PollView` du moteur. */
export interface PollView {
  questionId: string
  multiple: boolean
  voters: number
  options: { label: string; votes: number }[]
}

/** Diffusé quand l'hôte relance une partie depuis le podium (une variante par rôle). */
export type SessionRelaunchedView =
  | { role: 'player'; pin: string; playerId: string; joinToken: string; nickname: string }
  | { role: 'screen'; pin: string; sessionId: string; displayToken: string }

/** Code d'ack renvoyé par `player:reconnect` quand le joueur a été exclu. */
export const KICKED_ACK_CODE = 'kicked'

/** Codes machine des refus (`{ error, code }` ou `{ accepted: false, reason, code }`). Le message
 * arrive dans la langue de la socket : l'écran compare toujours le code, jamais le texte. */
/** Commande d'hôte venue d'une socket qui n'est pas (ou plus) l'hôte de la partie. */
export const NOT_HOST_ACK_CODE = 'NOT_HOST'
/** `player:join` refusé : la partie a atteint son plafond de joueurs. */
export const SESSION_FULL_ACK_CODE = 'SESSION_FULL'
/** `player:answer` refusé : réponse invalide pour le type de question, la manche reste ouverte. */
export const INVALID_ANSWER_ACK_CODE = 'INVALID_ANSWER'
