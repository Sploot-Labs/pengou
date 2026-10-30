import { describe, it, expect } from 'vitest'
import { sniffImageType } from './media-sniff.js'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('sniffImageType', () => {
  it.each([
    ['png', PNG],
    ['jpg', [0xff, 0xd8, 0xff, 0xe0]],
    ['gif', [...Buffer.from('GIF89a')]],
    ['gif', [...Buffer.from('GIF87a')]],
    ['webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]],
  ])('reconnaît %s', (kind, bytes) => expect(sniffImageType(Uint8Array.from(bytes))).toBe(kind))

  it('refuse un SVG même nommé .png', () => expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull())
  it("refuse un RIFF qui n'est pas du WebP (WAV)", () => expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull())
  it('refuse un tampon trop court', () => expect(sniffImageType(Uint8Array.from([0x89, 0x50]))).toBeNull())
  it('refuse un tampon vide', () => expect(sniffImageType(new Uint8Array(0))).toBeNull())
})
