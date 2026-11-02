import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type CloudWordInput, layoutCloud, type PlacedWord, sortWords, STAGE_H, STAGE_W } from './layout'
import { useWordMeasure } from './useWordMeasure'

export { useWordMeasure } from './useWordMeasure'

export interface BigWordCloudProps {
  words: CloudWordInput[]
  /** Utilisé par la phase de révélation (ignoré en direct). */
  revealed: boolean
  reducedMotion: boolean
  emptyLabel?: string
}

type Point = { x: number; y: number }

export function BigWordCloud({
  words,
  reducedMotion,
  emptyLabel = 'En attente des premières idées…',
}: BigWordCloudProps) {
  const { measure, version } = useWordMeasure()
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  // Premier mot reçu de la question et positions précédentes : conservés d'une mise à jour à l'autre.
  const firstKeyRef = useRef<string | undefined>(undefined)
  const previousRef = useRef(new Map<string, Point>())
  // Dernier compteur connu de chaque mot (pour la pulsation).
  const countsRef = useRef(new Map<string, number>())
  const textRefs = useRef(new Map<string, HTMLSpanElement>())

  const sorted = useMemo(() => sortWords(words), [words])
  if (firstKeyRef.current === undefined && sorted[0]) firstKeyRef.current = sorted[0].key

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` force le recalcul quand les polices sont prêtes.
  const { placed } = useMemo(
    () => layoutCloud(sorted, { measure, previous: previousRef.current, firstKey: firstKeyRef.current }),
    [sorted, measure, version],
  )

  useEffect(() => {
    const next = new Map<string, Point>()
    for (const w of placed) next.set(w.key, { x: w.x, y: w.y })
    previousRef.current = next
  }, [placed])

  // Éclosion : la classe `is-new` est posée au montage du mot (l'animation ne joue qu'une fois).
  // Pulsation : la classe est retirée, un reflow est forcé, puis elle est reposée.
  useLayoutEffect(() => {
    if (reducedMotion) {
      for (const w of placed) countsRef.current.set(w.key, w.count)
      return
    }
    for (const w of placed) {
      const before = countsRef.current.get(w.key)
      countsRef.current.set(w.key, w.count)
      if (before === undefined || w.count <= before) continue
      const el = textRefs.current.get(w.key)
      if (!el) continue
      el.classList.remove('is-new', 'is-bump')
      void el.offsetWidth
      el.classList.add('is-bump')
    }
  }, [placed, reducedMotion])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    const fit = () => {
      if (frame.clientWidth > 0) setScale(frame.clientWidth / STAGE_W)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(frame)
    fit()
    return () => ro.disconnect()
  }, [])

  const cls = ['bigcloud', reducedMotion ? 'bigcloud--still' : ''].filter(Boolean).join(' ')

  return (
    <div className={cls} ref={frameRef}>
      <div className="bigcloud__stage" aria-hidden="true" style={{ transform: `scale(${scale})` }}>
        {placed.length === 0 && <p className="bigcloud__empty">{emptyLabel}</p>}
        {placed.map((w) => (
          <CloudWord
            key={w.key}
            word={w}
            register={(el) => {
              if (el) textRefs.current.set(w.key, el)
              else textRefs.current.delete(w.key)
            }}
          />
        ))}
      </div>
      <ul className="visually-hidden" aria-label="Nuage de mots">
        {sorted.map((w) => (
          <li key={w.key}>{`${w.text}, ${w.count}`}</li>
        ))}
      </ul>
    </div>
  )
}

function CloudWord({
  word,
  register,
}: {
  word: PlacedWord
  register: (el: HTMLSpanElement | null) => void
}) {
  const style: CSSProperties = { transform: `translate(${word.x}px, ${word.y}px)` }
  const rot: CSSProperties = {
    transform: `translate(-50%, -50%) rotate(${word.vertical ? -90 : 0}deg)`,
  }
  return (
    <div
      className={`bigcloud__word bigcloud__word--c${word.colorIndex}`}
      style={style}
      data-key={word.key}
      data-top={word.rank === 1}
      data-small={word.small}
      data-vertical={word.vertical}
    >
      <div className="bigcloud__rot" style={rot}>
        <span
          className="bigcloud__text is-new"
          style={{ fontSize: `${word.fontSize}px` }}
          ref={register}
        >
          {word.text}
        </span>
      </div>
    </div>
  )
}
