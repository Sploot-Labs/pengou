import { describe, it, expect } from 'vitest'
import { generatePin } from './pin.js'

describe('generatePin', () => {
  it('produces a 6-digit numeric string', () => {
    for (let i = 0; i < 50; i++) {
      const pin = generatePin()
      expect(pin).toMatch(/^\d{6}$/)
    }
  })

  it('zero-pads short numbers to 6 digits', () => {
    // statistically likely to hit a small number across enough draws; just assert format holds
    const pins = Array.from({ length: 200 }, () => generatePin())
    for (const pin of pins) expect(pin.length).toBe(6)
  })
})
