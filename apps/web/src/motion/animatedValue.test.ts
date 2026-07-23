import { describe, expect, it } from 'vitest'
import { easeOut, interpolate } from './animatedValue.js'

describe('animatedValue', () => {
  it('interpolate renvoie les bornes à t=0 et t=1', () => {
    expect(interpolate(10, 20, 0)).toBe(10)
    expect(interpolate(10, 20, 1)).toBe(20)
  })

  it('interpolate clampe t hors [0,1]', () => {
    expect(interpolate(0, 100, -0.5)).toBe(0)
    expect(interpolate(0, 100, 2)).toBe(100)
  })

  it('interpolate est linéaire au milieu', () => {
    expect(interpolate(0, 100, 0.5)).toBe(50)
  })

  it('easeOut est monotone et borné', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5) // décélération : dépasse la linéaire
  })
})
