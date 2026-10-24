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
  // Passage de phase : chaque bascule a son son « banquise ». L'ambiance du
  // lobby (son `lobby`, en boucle) n'est PAS déclenchée ici : c'est une boucle
  // à cycle de vie (démarrer en lobby, couper en sortant), pilotée directement
  // par BigScreen via `sound.loop`/`sound.stop` — ce moteur ne fait que des
  // one-shots.
  'phase.enter:reading': { sound: 'reading' },
  'phase.enter:question': { sound: 'question' },
  'phase.enter:reveal': { animation: sweepIn, sound: 'reveal' },
  'phase.enter:scoreboard': { animation: sweepIn, sound: 'scoreboard' },
  'phase.enter:podium': {
    animation: sweepIn,
    sound: 'podium',
    // NOTE (scope honnête) : ce champ `media` n'est PAS ENCORE consommé par
    // `MotionProvider.fire` (voir MotionProvider.tsx) — aucun composant ne lit
    // `effect.media`, et `MediaOverlay` n'a aucun consommateur. La célébration
    // confettis du podium vient en réalité du `<Confetti active />` monté
    // directement dans BigScreen (screens/BigScreen.tsx), PAS de cette entrée
    // de registre. Le câblage MediaOverlay est un suivi (follow-up).
    media: { src: 'confetti-bg', mode: 'overlay' },
  },
  'answer.submit': { sound: 'tap' },
  'answer.correct': { animation: pulseGreen, sound: 'correct' },
  'answer.incorrect': { animation: shake, sound: 'incorrect' },
  'timer.urgent': { sound: 'tick', reducedMotion: 'skip' },
  'player.join': { sound: 'join' },
}
