import { createElement, type ReactNode } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Apparition (fade + rise). Le contenu est TOUJOURS dans le DOM (l'animation
 * n'est qu'un habillage) ; en reduced-motion, aucun transform ni délai. */
export function Reveal({
  as = 'div',
  from = 'up',
  delay = 0,
  children,
}: {
  as?: keyof JSX.IntrinsicElements
  from?: 'up' | 'down' | 'none'
  delay?: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const offset = from === 'up' ? 'var(--rise)' : from === 'down' ? 'calc(-1 * var(--rise))' : '0'
  const style = reduced
    ? undefined
    : {
        animation: `ab-reveal var(--dur-base) var(--ease-out) ${delay}ms both`,
        ['--reveal-from' as string]: offset,
      }
  return createElement(as, { style }, children)
}
