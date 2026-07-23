import { describe, it, expect } from 'vitest'
import { mcq } from './mcq.js'
import { truefalse } from './truefalse.js'
import { text } from './text.js'
import { slider } from './slider.js'

const opts = (timeMs: number) => ({ timeMs, maxMs: 10000, basePoints: 1000 })

describe('mcq gameplay', () => {
  const payload = mcq.validatePayload({
    options: [
      { label: 'A', correct: true },
      { label: 'B', correct: false },
      { label: 'C', correct: false },
    ],
  })

  it('validateAnswer accepte { optionIndex }', () => {
    expect(mcq.validateAnswer({ optionIndex: 1 })).toEqual({ optionIndex: 1 })
  })

  it('validateAnswer rejette une réponse mal formée', () => {
    expect(() => mcq.validateAnswer({ optionIndex: -1 })).toThrow()
    expect(() => mcq.validateAnswer({ optionIndex: 1.5 })).toThrow()
    expect(() => mcq.validateAnswer({})).toThrow()
    expect(() => mcq.validateAnswer({ optionIndex: 'nope' })).toThrow()
  })

  it('isCorrect vrai/faux selon l’option choisie', () => {
    expect(mcq.isCorrect(payload, { optionIndex: 0 })).toBe(true)
    expect(mcq.isCorrect(payload, { optionIndex: 1 })).toBe(false)
  })

  it('playerView ne contient JAMAIS le champ `correct`', () => {
    const view = mcq.playerView(payload) as { options: Array<Record<string, unknown>> }
    expect(view.options).toHaveLength(3)
    for (const o of view.options) {
      expect(o).not.toHaveProperty('correct')
      expect(Object.keys(o)).toEqual(['label'])
    }
  })

  it('score = 0 si faux, > 0 et dépendant de la vitesse si correct', () => {
    expect(mcq.score(payload, { optionIndex: 1 }, opts(0))).toBe(0)
    const fast = mcq.score(payload, { optionIndex: 0 }, opts(0))
    const slow = mcq.score(payload, { optionIndex: 0 }, opts(10000))
    expect(fast).toBeGreaterThan(0)
    expect(fast).toBe(1000)
    expect(slow).toBe(500)
    expect(fast).toBeGreaterThan(slow)
  })
})

describe('truefalse gameplay', () => {
  const payload = truefalse.validatePayload({ correct: true })

  it('validateAnswer accepte { value: boolean }', () => {
    expect(truefalse.validateAnswer({ value: false })).toEqual({ value: false })
  })

  it('validateAnswer rejette une réponse mal formée', () => {
    expect(() => truefalse.validateAnswer({ value: 'true' })).toThrow()
    expect(() => truefalse.validateAnswer({})).toThrow()
  })

  it('isCorrect compare value à payload.correct', () => {
    expect(truefalse.isCorrect(payload, { value: true })).toBe(true)
    expect(truefalse.isCorrect(payload, { value: false })).toBe(false)
  })

  it('playerView ne contient JAMAIS `correct`', () => {
    const view = truefalse.playerView(payload)
    expect(view).toEqual({})
    expect(view).not.toHaveProperty('correct')
  })

  it('score = 0 si faux, > 0 si correct', () => {
    expect(truefalse.score(payload, { value: false }, opts(0))).toBe(0)
    expect(truefalse.score(payload, { value: true }, opts(0))).toBe(1000)
    expect(truefalse.score(payload, { value: true }, opts(10000))).toBe(500)
  })
})

describe('text gameplay', () => {
  const payload = text.validatePayload({ answers: ['Café'], caseSensitive: false })

  it('validateAnswer accepte { text: string }', () => {
    expect(text.validateAnswer({ text: 'cafe' })).toEqual({ text: 'cafe' })
  })

  it('validateAnswer rejette une réponse mal formée', () => {
    expect(() => text.validateAnswer({ text: 42 })).toThrow()
    expect(() => text.validateAnswer({})).toThrow()
  })

  it('isCorrect normalise (trim, casse, accents) avant de comparer', () => {
    expect(text.isCorrect(payload, { text: '  cafe  ' })).toBe(true)
    expect(text.isCorrect(payload, { text: 'CAFE' })).toBe(true)
    expect(text.isCorrect(payload, { text: 'Café' })).toBe(true)
    expect(text.isCorrect(payload, { text: 'thé' })).toBe(false)
  })

  it('respecte caseSensitive=true', () => {
    const strict = text.validatePayload({ answers: ['Paris'], caseSensitive: true })
    expect(text.isCorrect(strict, { text: 'paris' })).toBe(false)
    expect(text.isCorrect(strict, { text: 'Paris' })).toBe(true)
  })

  it('playerView ne contient JAMAIS `answers`', () => {
    const view = text.playerView(payload)
    expect(view).toEqual({})
    expect(view).not.toHaveProperty('answers')
  })

  it('score = 0 si faux, > 0 si correct', () => {
    expect(text.score(payload, { text: 'thé' }, opts(0))).toBe(0)
    expect(text.score(payload, { text: 'cafe' }, opts(0))).toBe(1000)
    expect(text.score(payload, { text: 'cafe' }, opts(10000))).toBe(500)
  })
})

describe('slider gameplay', () => {
  const payload = slider.validatePayload({ min: 0, max: 100, correct: 50 })

  it('validateAnswer accepte { value: number }', () => {
    expect(slider.validateAnswer({ value: 48 })).toEqual({ value: 48 })
  })

  it('validateAnswer rejette une réponse mal formée', () => {
    expect(() => slider.validateAnswer({ value: 'nope' })).toThrow()
    expect(() => slider.validateAnswer({})).toThrow()
  })

  it('isCorrect dans la tolérance (5% de la plage, min 1)', () => {
    // plage 100 → tolérance = round(0.05*100) = 5
    expect(slider.isCorrect(payload, { value: 50 })).toBe(true)
    expect(slider.isCorrect(payload, { value: 54 })).toBe(true)
    expect(slider.isCorrect(payload, { value: 55 })).toBe(true)
    expect(slider.isCorrect(payload, { value: 56 })).toBe(false)
    expect(slider.isCorrect(payload, { value: 44 })).toBe(false)
  })

  it('playerView ne contient JAMAIS `correct`, seulement { min, max }', () => {
    const view = slider.playerView(payload)
    expect(view).toEqual({ min: 0, max: 100 })
    expect(view).not.toHaveProperty('correct')
  })

  it('score = 0 hors tolérance', () => {
    expect(slider.score(payload, { value: 90 }, opts(0))).toBe(0)
  })

  it('score plein à la valeur exacte, dégressif avec la distance, x bonus de vitesse', () => {
    const exact = slider.score(payload, { value: 50 }, opts(0))
    const near = slider.score(payload, { value: 53 }, opts(0))
    expect(exact).toBe(1000)
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(exact)
    const exactSlow = slider.score(payload, { value: 50 }, opts(10000))
    expect(exactSlow).toBeLessThan(exact)
    expect(exactSlow).toBeGreaterThan(0)
  })
})
