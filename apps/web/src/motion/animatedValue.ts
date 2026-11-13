/** Contrat d'interpolation partagé par CountUp, AnimatedBar, TimerRing. */

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Interpolation linéaire, t clampé dans [0,1]. */
export function interpolate(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t)
}

/** Décélération (ease-out cubique) : rapide au début, lent à la fin. */
export function easeOut(t: number): number {
  const c = clamp01(t)
  return 1 - (1 - c) ** 3
}
