// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../AppShell'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

describe('AppShell', () => {
  it('pose data-theme="app" par défaut autour du contenu', () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>x</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-theme="app"]')).not.toBeNull()
  })
})
