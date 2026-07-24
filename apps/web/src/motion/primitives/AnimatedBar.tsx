import { useReducedMotion } from '../MotionProvider.js'

/** Barre qui « pousse » via transform: scaleY (composité, 60fps) plutôt que
 * height (reflow). En reduced-motion, la barre est directement à sa hauteur
 * finale sans transition. */
export function AnimatedBar({
  value,
  max,
  color,
  grow = 'up',
  label,
}: {
  value: number
  max: number
  color: string
  grow?: 'up'
  label?: string
}) {
  const reduced = useReducedMotion()
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div
      data-bar
      aria-label={label}
      style={{
        ['--bar-scale' as string]: String(ratio),
        background: color,
        transformOrigin: grow === 'up' ? 'bottom' : 'top',
        transform: 'scaleY(var(--bar-scale))',
        transition: reduced ? 'none' : 'transform var(--dur-slow) var(--ease-out)',
        height: '100%',
        width: '100%',
        borderRadius: 'var(--radius-sm)',
      }}
    />
  )
}
