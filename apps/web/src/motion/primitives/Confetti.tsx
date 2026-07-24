import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Célébration : particules sur un <canvas> en overlay (aucun reflow DOM).
 * Monté seulement quand `active`. aria-hidden (purement décoratif). Coupé en
 * reduced-motion. */
export function Confetti({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active || reduced) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const colors = ['#e88a3c', '#4fa3a0', '#f2a900', '#d96a52']
    const parts = Array.from({ length: 120 }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      vy: 2 + Math.random() * 3,
      vx: -1 + Math.random() * 2,
      size: 4 + Math.random() * 6,
      color: colors[i % colors.length],
    }))
    let raf = 0
    let stopped = false
    const started = performance.now()
    function frame(now: number) {
      if (stopped || !ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        ctx.fillStyle = p.color
        ctx.fillRect(p.x, p.y, p.size, p.size)
      }
      if (now - started < 4000) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [active, reduced])

  if (!active || reduced) return null
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
