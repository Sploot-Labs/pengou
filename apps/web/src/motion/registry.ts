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

/**
 * LA table cue → effets. Ajouter une animation/son/vidéo « partout » = éditer
 * CE fichier, jamais un écran. Démarre quasi vide (rempli surface par surface,
 * Tasks 9+).
 */
export const registry: Partial<Record<string, CueEffect>> = {}
