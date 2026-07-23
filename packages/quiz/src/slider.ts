import { z } from 'zod'
import type { QuestionTypeDef } from './types.js'
import { speedBonus } from './scoring.js'

const sliderSchema = z.object({
  min: z.number(),
  max: z.number(),
  correct: z.number(),
  step: z.number().positive().optional(),
}).refine((p) => p.min < p.max, { message: 'min doit être < max' })
  .refine((p) => p.correct >= p.min && p.correct <= p.max, { message: 'correct doit être dans [min, max]' })

export type SliderPayload = z.infer<typeof sliderSchema>

const answerSchema = z.object({ value: z.number() })
export type SliderAnswer = z.infer<typeof answerSchema>

/** Tolérance en unités du curseur : `max(1, round(5% de l'étendue [min, max]))`.
 * Exportée (pas seulement interne à `slider.ts`) car le front (`apps/web/src/
 * realtime/distribution.ts`, décodage de `question:reveal` pour l'affichage
 * hôte/grand écran) doit appliquer EXACTEMENT la même règle pour marquer une
 * valeur reçue comme « dans la tolérance » — une formule dupliquée à la main
 * dériverait silencieusement de celle-ci au moindre changement ici. */
export function sliderTolerance(min: number, max: number): number {
  return Math.max(1, Math.round(0.05 * (max - min)))
}

function tolerance(p: SliderPayload): number {
  return sliderTolerance(p.min, p.max)
}

export const slider: QuestionTypeDef<SliderPayload, SliderAnswer> = {
  key: 'slider',
  validatePayload: (raw) => sliderSchema.parse(raw),
  validateAnswer: (raw) => answerSchema.parse(raw),
  playerView: (p) => ({ min: p.min, max: p.max }), // pas de `correct`
  isCorrect: (p, a) => Math.abs(a.value - p.correct) <= tolerance(p),
  score: (p, a, o) => {
    if (!slider.isCorrect(p, a)) return 0
    const tol = tolerance(p)
    const distance = Math.abs(a.value - p.correct)
    // plein si exact, dégressif mais TOUJOURS > 0 dans la tolérance (dénominateur tol+1 :
    // à distance===tol, proximity = 1/(tol+1) > 0). Garantit isCorrect===true ⟹ score > 0.
    const proximity = 1 - distance / (tol + 1)
    return speedBonus(Math.round(o.basePoints * proximity), o.timeMs, o.maxMs)
  },
}
