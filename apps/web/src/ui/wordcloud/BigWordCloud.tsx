import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type CloudWordInput, layoutCloud, type PlacedWord, sortWords, STAGE_W } from './layout'
import { useWordMeasure } from './useWordMeasure'

export { useWordMeasure } from './useWordMeasure'

export interface BigWordCloudProps {
  words: CloudWordInput[]
  /** Phase de révélation : disposition figée, top 4 allumé avec ses pastilles. */
  revealed: boolean
  reducedMotion: boolean
  emptyLabel?: string
}

type Point = { x: number; y: number }

const TOP_COUNT = 4
const BADGE_FIRST_DELAY = 900
const BADGE_STEP = 550
const RECONNECT_WINDOW = 1000
const LEAVE_DELAY = 400

export function BigWordCloud({
  words,
  revealed,
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

  // Disposition en direct. En révélation, `layoutCloud` n'est plus appelé : la disposition est figée.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` force le recalcul quand les polices sont prêtes.
  const live = useMemo(
    () =>
      revealed
        ? null
        : layoutCloud(sorted, { measure, previous: previousRef.current, firstKey: firstKeyRef.current }).placed,
    [sorted, measure, version, revealed],
  )

  // Instant du premier rendu en direct avec au moins un mot (détection d'une reconnexion).
  const firstWordsAtRef = useRef<number | null>(null)
  if (live && words.length > 0 && firstWordsAtRef.current === null) firstWordsAtRef.current = Date.now()

  const lastLiveRef = useRef<PlacedWord[]>([])
  const frozenRef = useRef<PlacedWord[] | null>(null)
  // Arrivée échelonnée des pastilles : décidée une fois, au passage en révélation.
  const instantRef = useRef(false)
  if (!revealed) frozenRef.current = null
  else if (!frozenRef.current) {
    frozenRef.current = lastLiveRef.current.length
      ? lastLiveRef.current
      : layoutCloud(sorted, { measure, previous: previousRef.current, firstKey: firstKeyRef.current }).placed
    // Échelonné seulement si des mots ont été vus en direct depuis au moins 1000 ms ; sinon (aucun mot
    // vu, ou révélation quasi simultanée) c'est une reconnexion : état final d'un coup.
    const seenAt = firstWordsAtRef.current
    instantRef.current = reducedMotion || seenAt === null || Date.now() - seenAt < RECONNECT_WINDOW
  }

  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [step, setStep] = useState(0)

  // Vue de révélation : mots figés, absents retirés (ou en fondu), compteurs à jour.
  const present = new Map(words.map((w) => [w.key, w]))
  const placed: PlacedWord[] = live
    ? live
    : (frozenRef.current ?? [])
        .filter((f) => present.has(f.key) || (!reducedMotion && !gone.has(f.key)))
        .map((f) => {
          const p = present.get(f.key)
          return p ? { ...f, count: p.count } : f
        })
  const top = revealed ? sortWords(placed.filter((f) => present.has(f.key))).slice(0, TOP_COUNT) : []
  const lit = new Set(top.map((t) => t.key))

  useEffect(() => {
    if (!live) return
    const next = new Map<string, Point>()
    for (const w of live) next.set(w.key, { x: w.x, y: w.y })
    previousRef.current = next
    lastLiveRef.current = live
  }, [live])

  // Mots retirés pendant la révélation : fondu de 400 ms, puis retrait.
  const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = leaveTimers.current
    if (!revealed) {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      setGone((g) => (g.size ? new Set() : g))
      return
    }
    for (const f of frozenRef.current ?? []) {
      if (present.has(f.key)) {
        const t = timers.get(f.key)
        if (t) clearTimeout(t)
        timers.delete(f.key)
        setGone((g) => {
          if (!g.has(f.key)) return g
          const n = new Set(g)
          n.delete(f.key)
          return n
        })
      } else if (!timers.has(f.key) && !gone.has(f.key)) {
        timers.set(
          f.key,
          setTimeout(() => setGone((g) => new Set(g).add(f.key)), LEAVE_DELAY),
        )
      }
    }
  })
  useEffect(
    () => () => {
      for (const t of leaveTimers.current.values()) clearTimeout(t)
    },
    [],
  )

  // Pastilles : de la dernière du top à la première, 900 ms puis 550 ms d'intervalle.
  useEffect(() => {
    if (!revealed) {
      setStep(0)
      return
    }
    if (instantRef.current) return
    const timers = Array.from({ length: TOP_COUNT }, (_, k) =>
      setTimeout(() => setStep(k + 1), BADGE_FIRST_DELAY + k * BADGE_STEP),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [revealed])

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

  const cls = ['bigcloud', reducedMotion ? 'bigcloud--still' : '', revealed ? 'bigcloud--revealed' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} ref={frameRef}>
      <div className="bigcloud__stage" aria-hidden="true" style={{ transform: `scale(${scale})` }}>
        {placed.map((w) => (
          <CloudWord
            key={w.key}
            word={w}
            lit={lit.has(w.key)}
            leaving={revealed && !present.has(w.key)}
            register={(el) => {
              if (el) textRefs.current.set(w.key, el)
              else textRefs.current.delete(w.key)
            }}
          />
        ))}
        {top.map((w, i) => {
          const rank = i + 1
          if (!instantRef.current && step < top.length - rank + 1) return null
          return (
            <div
              key={`badge-${rank}`}
              className={`bigcloud__badge bigcloud__word--c${w.colorIndex}`}
              style={{ left: `${w.x + w.boxW / 2}px`, top: `${w.y - w.boxH / 2}px` }}
              aria-hidden="true"
            >
              <span className="bigcloud__rank">{rank}</span>
              {`${w.count} fois`}
            </div>
          )
        })}
      </div>
      {placed.length === 0 && <p className="bigcloud__empty">{emptyLabel}</p>}
      {revealed && top.length > 0 && (
        <ol className="visually-hidden" aria-label="Mots les plus proposés">
          {top.map((w, i) => (
            <li key={w.key}>{`${i + 1}. ${w.text}, ${w.count} fois`}</li>
          ))}
        </ol>
      )}
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
  lit,
  leaving,
  register,
}: {
  word: PlacedWord
  lit: boolean
  leaving: boolean
  register: (el: HTMLSpanElement | null) => void
}) {
  const style: CSSProperties = { transform: `translate(${word.x}px, ${word.y}px)` }
  const rot: CSSProperties = {
    transform: `translate(-50%, -50%) rotate(${word.vertical ? -90 : 0}deg)`,
  }
  return (
    <div
      className={`bigcloud__word bigcloud__word--c${word.colorIndex}${leaving ? ' is-leaving' : ''}`}
      style={style}
      data-key={word.key}
      data-lit={lit ? 'true' : undefined}
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
