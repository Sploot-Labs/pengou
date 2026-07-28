import { describe, it, expect } from 'vitest'
import { isSafeMedia, tooLong, LIMITS } from './validation.js'

describe('tooLong', () => {
  it('vrai au-delà de la borne, faux en-dessous, faux pour non-string', () => {
    expect(tooLong('x'.repeat(11), 10)).toBe(true)
    expect(tooLong('x'.repeat(10), 10)).toBe(false)
    expect(tooLong(undefined, 10)).toBe(false)
    expect(tooLong(12345, 10)).toBe(false)
  })
})

describe('isSafeMedia (allowlist)', () => {
  it('accepte les références relatives et les URLs http(s)', () => {
    expect(isSafeMedia('clip.mp4')).toBe(true)
    expect(isSafeMedia('/media/clip.webm')).toBe(true)
    expect(isSafeMedia('http://example.com/x.png')).toBe(true)
    expect(isSafeMedia('https://example.com/x.png')).toBe(true)
  })

  it('refuse les schémas dangereux, quelle que soit la casse / les espaces', () => {
    expect(isSafeMedia('javascript:alert(1)')).toBe(false)
    expect(isSafeMedia('  JavaScript:alert(1)')).toBe(false)
    expect(isSafeMedia('data:text/html,<script>')).toBe(false)
    expect(isSafeMedia('vbscript:msgbox')).toBe(false)
    // Tout autre schéma non http(s) est refusé (allowlist, pas denylist).
    expect(isSafeMedia('file:///etc/passwd')).toBe(false)
    expect(isSafeMedia('ftp://x/y')).toBe(false)
  })

  it('refuse les caractères de contrôle et les chaînes trop longues', () => {
    expect(isSafeMedia('java\tscript:alert(1)')).toBe(false)
    expect(isSafeMedia('x'.repeat(LIMITS.media + 1))).toBe(false)
  })
})
