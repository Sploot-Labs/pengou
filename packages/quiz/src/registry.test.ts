import { describe, it, expect } from 'vitest'
import { validateQuestionPayload, isScoredType } from './index.js'

describe('validateQuestionPayload', () => {
  it('mcq : accepte 4 options avec ≥1 correcte', () => {
    const p = validateQuestionPayload('mcq', {
      options: [
        { label: 'A', correct: true },
        { label: 'B', correct: false },
        { label: 'C', correct: false },
        { label: 'D', correct: false },
      ],
    })
    expect(p).toBeTruthy()
  })
  it('mcq : rejette 0 correcte', () => {
    expect(() =>
      validateQuestionPayload('mcq', {
        options: [
          { label: 'A', correct: false },
          { label: 'B', correct: false },
        ],
      }),
    ).toThrow()
  })
  it('mcq : rejette <2 options', () => {
    expect(() => validateQuestionPayload('mcq', { options: [{ label: 'A', correct: true }] })).toThrow()
  })
  it('truefalse : accepte { correct: true }', () => {
    expect(validateQuestionPayload('truefalse', { correct: true })).toEqual({ correct: true })
  })
  it('text : accepte ≥1 réponse, rejette vide', () => {
    expect(validateQuestionPayload('text', { answers: ['Paris'] })).toBeTruthy()
    expect(() => validateQuestionPayload('text', { answers: [] })).toThrow()
  })
  it('slider : min<max et min≤correct≤max', () => {
    expect(validateQuestionPayload('slider', { min: 0, max: 100, correct: 42 })).toBeTruthy()
    expect(() => validateQuestionPayload('slider', { min: 0, max: 100, correct: 200 })).toThrow()
    expect(() => validateQuestionPayload('slider', { min: 100, max: 0, correct: 50 })).toThrow()
  })
  it('type inconnu : lève', () => {
    expect(() => validateQuestionPayload('nope' as never, {})).toThrow()
  })
  it('isScoredType : sondage et nuage de mots non notés', () => {
    expect(isScoredType('poll')).toBe(false)
    expect(isScoredType('wordcloud')).toBe(false)
    for (const t of ['mcq', 'truefalse', 'text', 'slider'] as const) expect(isScoredType(t)).toBe(true)
  })
})
