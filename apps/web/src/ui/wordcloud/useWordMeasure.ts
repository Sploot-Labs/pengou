import { useEffect, useRef, useState } from 'react'
import type { Measure } from './layout'

/**
 * Mesure du texte à 100 px de police via un span caché. `version` s'incrémente quand les
 * polices web sont prêtes (le cache est alors vidé et le placement doit être recalculé).
 */
export function useWordMeasure(): { measure: Measure; version: number } {
  const [version, setVersion] = useState(0)
  const spanRef = useRef<HTMLSpanElement | null>(null)
  const cacheRef = useRef(new Map<string, { w: number; h: number }>())

  const measureRef = useRef<Measure>((text) => {
    const cached = cacheRef.current.get(text)
    if (cached) return cached
    let span = spanRef.current
    if (!span && typeof document !== 'undefined') {
      span = document.createElement('span')
      span.className = 'bigcloud__measure'
      span.setAttribute('aria-hidden', 'true')
      document.body.appendChild(span)
      spanRef.current = span
    }
    let result = { w: text.length * 55, h: 100 }
    if (span) {
      span.textContent = text
      // jsdom ne fait pas de mise en page : repli sur une estimation.
      if (span.offsetWidth > 0) result = { w: span.offsetWidth, h: span.offsetHeight }
      // Le texte mesuré ne doit pas rester dans le document (lecteurs d'écran, recherche de texte).
      span.textContent = ''
    }
    cacheRef.current.set(text, result)
    return result
  })

  useEffect(() => {
    let alive = true
    document.fonts?.ready.then(() => {
      if (!alive) return
      cacheRef.current.clear()
      setVersion((v) => v + 1)
    })
    return () => {
      alive = false
      spanRef.current?.remove()
      spanRef.current = null
    }
  }, [])

  return { measure: measureRef.current, version }
}
