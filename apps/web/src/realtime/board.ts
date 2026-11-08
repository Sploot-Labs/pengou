import type { RankingEntry } from './contracts'

/**
 * Entrées du tableau de l'hôte : le classement restreint aux joueurs présents (un joueur exclu
 * peut rester dans le dernier `scoreboard`), dans l'ordre du classement, suivi des joueurs
 * présents encore absents du classement, dans l'ordre de `players`.
 */
export function boardEntries(
  ranking: RankingEntry[],
  players: Array<{ id: string; nickname: string; score: number }>,
): RankingEntry[] {
  const present = new Set(players.map((p) => p.id))
  const ranked = ranking.filter((entry) => present.has(entry.playerId))
  const rankedIds = new Set(ranked.map((entry) => entry.playerId))
  const unranked = players
    .filter((p) => !rankedIds.has(p.id))
    .map((p) => ({ playerId: p.id, nickname: p.nickname, score: p.score }))
  return [...ranked, ...unranked]
}
