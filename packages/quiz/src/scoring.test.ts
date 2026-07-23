import { describe, it, expect } from 'vitest'
import { speedBonus } from './scoring.js'

describe('speedBonus', () => {
  it('t=0 → basePoints (score plein)', () => {
    expect(speedBonus(1000, 0, 10000)).toBe(1000)
  })
  it('t=maxMs → round(basePoints*0.5)', () => {
    expect(speedBonus(1000, 10000, 10000)).toBe(500)
    expect(speedBonus(999, 10000, 10000)).toBe(Math.round(999 * 0.5))
  })
  it('t à mi-chemin → round(basePoints*0.75)', () => {
    expect(speedBonus(1000, 5000, 10000)).toBe(750)
  })
  it('t négatif → clampé à t=0 (basePoints plein)', () => {
    expect(speedBonus(1000, -500, 10000)).toBe(1000)
  })
  it('t > maxMs → clampé à maxMs (50%)', () => {
    expect(speedBonus(1000, 999999, 10000)).toBe(500)
  })
  it('maxMs <= 0 → basePoints (pas de chrono)', () => {
    expect(speedBonus(1000, 0, 0)).toBe(1000)
    expect(speedBonus(1000, 500, -1)).toBe(1000)
  })
})
