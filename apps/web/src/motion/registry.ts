import type { CueContext } from './cues.js'
import type { SoundId } from './sound/sounds.js'

export interface CueEffect {
  /** Animation visuelle (jouée par le moteur). Ignorée en reduced-motion. */
  animation?: (ctx: CueContext) => void
  /** Clé du catalogue de sons (indirection). */
  sound?: SoundId
  /** Overlay vidéo optionnel. */
  media?: { src: string; mode: 'overlay' | 'background' }
  /**
   * Comportement visuel en reduced-motion. Défaut : 'skip' (le son passe).
   * 'crossfade' est RÉSERVÉ pour <PhaseTransition> (Task ultérieure) : ce moteur
   * n'implémente pas de fondu enchaîné générique et traite 'crossfade' comme 'skip'.
   */
  reducedMotion?: 'skip' | 'crossfade'
}

import { pulseGreen, shake, sweepIn } from './effects.js'

/**
 * LA table cue → effets. Ajouter une animation/son/vidéo « partout » = éditer
 * CE fichier, jamais un écran.
 */
export const registry: Partial<Record<string, CueEffect>> = {
  'phase.enter:podium': {
    animation: sweepIn,
    sound: 'fanfare',
    // NOTE (scope honnête) : ce champ `media` n'est PAS ENCORE consommé par
    // `MotionProvider.fire` (voir MotionProvider.tsx) — aucun composant ne lit
    // `effect.media`, et `MediaOverlay` n'a aucun consommateur. La célébration
    // confettis du podium vient en réalité du `<Confetti active />` monté
    // directement dans BigScreen (screens/BigScreen.tsx), PAS de cette entrée
    // de registre. Le câblage MediaOverlay est un suivi (follow-up).
    media: { src: 'confetti-bg', mode: 'overlay' },
  },
  'phase.enter:scoreboard': { animation: sweepIn },
  'phase.enter:reveal': { animation: sweepIn },
  'answer.correct': { animation: pulseGreen, sound: 'ding' },
  'answer.incorrect': { animation: shake, sound: 'buzz' },
  'timer.urgent': { sound: 'tick', reducedMotion: 'skip' },
  'player.join': { sound: 'ding' },
}
