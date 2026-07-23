// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { BigScreen } from './BigScreen.js'

describe('BigScreen — habillage motion', () => {
  it('monte la sous-arborescence en thème scene / schéma dark', () => {
    const { container } = render(
      <MotionProvider>
        <MemoryRouter initialEntries={['/screen/s1?token=&pin=1234']}>
          <Routes>
            <Route path="/screen/:sessionId" element={<BigScreen />} />
          </Routes>
        </MemoryRouter>
      </MotionProvider>,
    )
    const scene = container.querySelector('[data-theme="scene"]')
    expect(scene).not.toBeNull()
    expect(scene?.getAttribute('data-scheme')).toBe('dark')
  })
})
