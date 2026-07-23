import type { CueContext } from './cues.js'

/** Effets visuels ponctuels via la Web Animations API (el.animate) : pas besoin
 * de framer-motion pour ces micro-animations ancrées à un élément. Chaque effet
 * est un no-op si aucun élément n'est fourni. */

export function pulseGreen(ctx: CueContext): void {
  ctx.el?.animate(
    [{ boxShadow: '0 0 0 0 rgba(95,167,120,0.7)' }, { boxShadow: '0 0 0 12px rgba(95,167,120,0)' }],
    { duration: 500, easing: 'cubic-bezier(0.22,1,0.36,1)' },
  )
}

export function shake(ctx: CueContext): void {
  ctx.el?.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 320, easing: 'ease-in-out' },
  )
}

export function sweepIn(ctx: CueContext): void {
  ctx.el?.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], {
    duration: 700,
    easing: 'cubic-bezier(0.34,1.56,0.64,1)',
    fill: 'both',
  })
}
