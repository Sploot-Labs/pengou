/** Moment sémantique nommé. Nommage : <domaine>.<moment>[:<variante>]. */
export type Cue =
  | `phase.enter:${'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'}`
  | 'answer.submit'
  | 'answer.correct'
  | 'answer.incorrect'
  | 'score.increment'
  | 'player.join'
  | 'podium.celebrate'
  | 'timer.urgent'
  // Union ouverte : un cue non répertorié reste typable et devient un no-op au
  // runtime (voir MotionProvider). Permet de semer des cue() avant de concevoir
  // leur effet.
  | (string & {})

/** Contexte optionnel passé à l'effet (ancre DOM, données du moment). */
export interface CueContext {
  el?: HTMLElement
  [k: string]: unknown
}
