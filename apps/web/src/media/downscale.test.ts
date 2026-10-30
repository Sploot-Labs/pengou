import { describe, expect, it } from 'vitest'
import { targetSize } from './downscale.js'

describe('targetSize', () => {
  it('ne touche pas une image de 1600 px', () => {
    expect(targetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 })
  })
  it('réduit 3200x1800 en 1600x900', () => {
    expect(targetSize(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 })
  })
  it('arrondit la hauteur', () => {
    expect(targetSize(4000, 3001, 1600)).toEqual({ width: 1600, height: 1200 })
  })
})
