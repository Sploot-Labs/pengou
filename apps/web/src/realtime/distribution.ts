/**
 * Décodage de `question:reveal.distribution` — partagé par `HostLive` et
 * `BigScreen` (les deux seuls écrans qui affichent une répartition de
 * réponses). Domaine réel, pas un mock : reflète exactement l'encodage du
 * serveur (`packages/game/src/engine.ts`, `questionResult()` — les clés sont
 * `JSON.stringify(réponse soumise)`, PAS un index d'option) et les formes de
 * payload de `packages/quiz/src/{mcq,truefalse,text,slider}.ts`.
 */

import { normalizeText, sliderTolerance } from '@splootlabs/quiz'

export type QuestionKind = 'mcq' | 'truefalse' | 'text' | 'slider'

export interface McqCorrect {
  options: { label: string; correct: boolean }[]
}
export interface TrueFalseCorrect {
  correct: boolean
}
export interface TextCorrect {
  answers: string[]
  caseSensitive?: boolean
}
export interface SliderCorrect {
  min: number
  max: number
  correct: number
  step?: number
}

/** Forme décorative des tuiles mcq — jamais un signal de correction (voir
 * `ui.tsx`/`AnswerTile`). */
export type ShapeKind = 'triangle' | 'diamond' | 'circle' | 'square'
export const MCQ_SHAPES: readonly ShapeKind[] = ['triangle', 'diamond', 'circle', 'square']

export interface DistRow {
  key: string
  label: string
  correct: boolean
  shape: ShapeKind | null
  count: number
}

function parseAnswerKey(key: string): unknown {
  try {
    return JSON.parse(key)
  } catch {
    return key
  }
}

function mcqRows(correct: McqCorrect, distribution: Record<string, number>): DistRow[] {
  return correct.options.map((opt, i) => ({
    key: String(i),
    label: opt.label,
    correct: opt.correct,
    shape: MCQ_SHAPES[i % MCQ_SHAPES.length],
    count: distribution[JSON.stringify({ optionIndex: i })] ?? 0,
  }))
}

function truefalseRows(correct: TrueFalseCorrect, distribution: Record<string, number>): DistRow[] {
  return [
    {
      key: 'true',
      label: 'Vrai',
      correct: correct.correct === true,
      shape: null,
      count: distribution[JSON.stringify({ value: true })] ?? 0,
    },
    {
      key: 'false',
      label: 'Faux',
      correct: correct.correct === false,
      shape: null,
      count: distribution[JSON.stringify({ value: false })] ?? 0,
    },
  ]
}

/** Pas de découpage en tranches côté serveur (contrairement au prototype) :
 * chaque valeur EXACTE effectivement soumise est comptée séparément — on
 * liste donc les valeurs reçues, triées, plutôt que d'inventer des buckets. */
function sliderRows(correct: SliderCorrect, distribution: Record<string, number>): DistRow[] {
  const tolerance = sliderTolerance(correct.min, correct.max)
  return Object.entries(distribution)
    .map(([key, count]) => {
      const parsed = parseAnswerKey(key)
      const value =
        typeof parsed === 'object' && parsed !== null && 'value' in parsed
          ? (parsed as { value: unknown }).value
          : null
      return typeof value === 'number' ? { value, count } : null
    })
    .filter((e): e is { value: number; count: number } => e !== null)
    .sort((a, b) => a.value - b.value)
    .map((e) => ({
      key: String(e.value),
      label: String(e.value),
      correct: Math.abs(e.value - correct.correct) <= tolerance,
      shape: null,
      count: e.count,
    }))
}

/** Idem : réponses libres, listées par fréquence décroissante (pas de
 * regroupement inventé au-delà du repli accents/casse déjà appliqué côté
 * moteur pour décider de la correction). */
function textRows(correct: TextCorrect, distribution: Record<string, number>): DistRow[] {
  const caseSensitive = correct.caseSensitive ?? false
  return Object.entries(distribution)
    .map(([key, count]) => {
      const parsed = parseAnswerKey(key)
      const value =
        typeof parsed === 'object' && parsed !== null && 'text' in parsed
          ? (parsed as { text: unknown }).text
          : null
      return typeof value === 'string' ? { value, count } : null
    })
    .filter((e): e is { value: string; count: number } => e !== null)
    .sort((a, b) => b.count - a.count)
    .map((e) => ({
      key: e.value,
      label: e.value.trim().length > 0 ? e.value : '(réponse vide)',
      correct: correct.answers.some(
        (candidate) => normalizeText(candidate, caseSensitive) === normalizeText(e.value, caseSensitive),
      ),
      shape: null,
      count: e.count,
    }))
}

export function buildDistributionRows(
  type: QuestionKind,
  correct: unknown,
  distribution: Record<string, number>,
): DistRow[] {
  switch (type) {
    case 'mcq':
      return mcqRows(correct as McqCorrect, distribution)
    case 'truefalse':
      return truefalseRows(correct as TrueFalseCorrect, distribution)
    case 'slider':
      return sliderRows(correct as SliderCorrect, distribution)
    case 'text':
      return textRows(correct as TextCorrect, distribution)
  }
}
