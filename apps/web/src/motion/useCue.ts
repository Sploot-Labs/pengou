import { useEffect } from 'react'
import type { Cue, CueContext } from './cues.js'
import { useMotion } from './MotionProvider.js'

/** Retourne la fonction d'émission de cue. */
export function useCue(): (cue: Cue, ctx?: CueContext) => void {
  return useMotion().fire
}

/** Forme déclarative : émet `on` quand `when` passe à vrai (ou au montage si non fourni). */
export function Cue({ on, when = true }: { on: Cue; when?: boolean }) {
  const fire = useCue()
  useEffect(() => {
    if (when) fire(on)
  }, [on, when, fire])
  return null
}
