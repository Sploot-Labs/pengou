import { describe, it, expect } from 'vitest'
import { PACKAGE_NAME } from './index'

describe('shared package', () => {
  it('exporte son nom', () => {
    expect(PACKAGE_NAME).toBe('@kahoot/shared')
  })
})
