import { describe, it, expect } from 'vitest'
import { poll, pollAnswerError, tallyPoll, pollPercent } from './poll.js'

const two = [{ label: 'A' }, { label: 'B' }]

describe('poll', () => {
  it('payload : multiple vaut false par défaut', () => {
    expect(poll.validatePayload({ options: two })).toEqual({ options: two, multiple: false })
  })
  it('payload : bornes des options et libellés', () => {
    expect(() => poll.validatePayload({ options: [{ label: 'A' }] })).toThrow()
    const seven = Array.from({ length: 7 }, (_, i) => ({ label: `o${i}` }))
    expect(() => poll.validatePayload({ options: seven })).toThrow()
    expect(() => poll.validatePayload({ options: [{ label: '' }, { label: 'B' }] })).toThrow()
    expect(() => poll.validatePayload({ options: [{ label: 'x'.repeat(201) }, { label: 'B' }] })).toThrow()
  })
  it('payload : retire une clé correct', () => {
    const p = poll.validatePayload({ options: [{ label: 'A', correct: true }, { label: 'B' }] })
    expect(p.options[0]).toEqual({ label: 'A' })
  })
  it('validateAnswer', () => {
    expect(() => poll.validateAnswer({ optionIndexes: [] })).toThrow()
    expect(() => poll.validateAnswer({ optionIndexes: [-1] })).toThrow()
    expect(poll.validateAnswer({ optionIndexes: [0, 2] })).toEqual({ optionIndexes: [0, 2] })
  })
  it('pollAnswerError', () => {
    const single = { options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multiple: false }
    const multi = { ...single, multiple: true }
    expect(pollAnswerError(single, { optionIndexes: [1] })).toBeNull()
    expect(pollAnswerError(multi, { optionIndexes: [0, 2] })).toBeNull()
    expect(pollAnswerError(multi, { optionIndexes: [0, 0] })).toEqual(expect.any(String))
    expect(pollAnswerError(multi, { optionIndexes: [3] })).toEqual(expect.any(String))
    expect(pollAnswerError(single, { optionIndexes: [0, 1] })).toEqual(expect.any(String))
  })
  it('playerView, isCorrect, score', () => {
    const p = { options: two, multiple: true }
    expect(poll.playerView(p)).toEqual({ options: [{ label: 'A' }, { label: 'B' }], multiple: true })
    expect(poll.isCorrect(p, { optionIndexes: [0] })).toBe(false)
    expect(poll.score(p, { optionIndexes: [0] }, { timeMs: 0, maxMs: 1000, basePoints: 100 })).toBe(0)
  })
})

describe('tallyPoll', () => {
  it('compte les votes et les votants', () => {
    expect(tallyPoll(3, [{ optionIndexes: [0] }, { optionIndexes: [0, 2] }, { optionIndexes: [9] }])).toEqual({
      votes: [2, 0, 1],
      voters: 2,
    })
    expect(tallyPoll(2, [])).toEqual({ votes: [0, 0], voters: 0 })
  })
})

describe('pollPercent', () => {
  it('arrondit, 0 sans votant', () => {
    expect(pollPercent(2, 3)).toBe(67)
    expect(pollPercent(0, 0)).toBe(0)
  })
})
