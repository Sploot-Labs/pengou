// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from './ThemeProvider.js'

describe('ThemeProvider', () => {
  it('pose data-theme sur son wrapper', () => {
    const { container } = render(<ThemeProvider theme="scene"><span>x</span></ThemeProvider>)
    const root = container.querySelector('[data-theme]')
    expect(root?.getAttribute('data-theme')).toBe('scene')
  })

  it('force data-scheme quand fourni (grand écran sombre)', () => {
    const { container } = render(
      <ThemeProvider theme="scene" scheme="dark"><span>x</span></ThemeProvider>,
    )
    const root = container.querySelector('[data-theme]')
    expect(root?.getAttribute('data-scheme')).toBe('dark')
  })
})
