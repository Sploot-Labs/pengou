import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../MotionProvider.js'
import { easeOut, interpolate } from '../animatedValue.js'

/** Nombre qui s'incrémente de l'ancienne valeur à `value`. En reduced-motion,
 * affiche directement la valeur finale. tabular-nums pour éviter le jitter. */
export function CountUp({
  value,
  format = (n) => String(n),
  durationMs = 600,
}: {
  value: number
  format?: (n: number) => string
  durationMs?: number
}) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      displayRef.current = value
      return
    }
    const from = displayRef.current
    const start = performance.now()
    let raf = 0
    function frame(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      const v = Math.round(interpolate(from, value, easeOut(t)))
      setDisplay(v)
      displayRef.current = v
      if (t < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs, reduced])

  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(display)}</span>
}
