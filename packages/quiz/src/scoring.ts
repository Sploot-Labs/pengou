// Bonus de rapidité : plein score à t=0, 50% du score à l'expiration.
export function speedBonus(basePoints: number, timeMs: number, maxMs: number): number {
  if (maxMs <= 0) return basePoints
  const frac = Math.max(0, Math.min(1, timeMs / maxMs))
  return Math.round(basePoints * (1 - 0.5 * frac))
}
