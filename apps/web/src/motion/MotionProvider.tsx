import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Cue, CueContext } from './cues.js'
import { registry } from './registry.js'
import { SoundManager } from './sound/SoundManager.js'

interface MotionContextValue {
  reducedMotion: boolean
  fire: (cue: Cue, ctx?: CueContext) => void
  sound: SoundManager
}

const MotionContext = createContext<MotionContextValue | null>(null)

export function useMotion(): MotionContextValue {
  const ctx = useContext(MotionContext)
  if (!ctx) throw new Error('useMotion doit être utilisé dans <MotionProvider>')
  return ctx
}

export function useReducedMotion(): boolean {
  return useMotion().reducedMotion
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion)
  const soundRef = useRef<SoundManager | null>(null)
  if (!soundRef.current) soundRef.current = new SoundManager()

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const value = useMemo<MotionContextValue>(() => {
    const sound = soundRef.current!
    return {
      reducedMotion,
      sound,
      fire(cue, ctx) {
        const effect = registry[cue]
        if (!effect) return // no-op : cue non enregistré
        // reducedMotion: 'skip' (défaut) = on saute le visuel, le son passe. 'crossfade' est
        // RÉSERVÉ : le fondu enchaîné entre phases est géré par <PhaseTransition> (qui lit
        // useReducedMotion directement), pas par ce moteur — donc traité comme 'skip' ici pour l'instant.
        if (effect.animation && !reducedMotion) effect.animation(ctx ?? {})
        if (effect.sound) sound.play(effect.sound)
        // media : câblé au MediaOverlay en Task 8 (ici : rien à faire côté moteur).
      },
    }
  }, [reducedMotion])

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
}
