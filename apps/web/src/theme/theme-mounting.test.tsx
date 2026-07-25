// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../AppShell'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SceneRoute } from '../routes'

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

describe('SceneRoute', () => {
  // Le montage de /join via le vrai `router` (createBrowserRouter) entraîne
  // ses dépendances socket/provider réelles dans le test — fragile et hors
  // sujet ici. On teste directement le helper de wrapping utilisé par
  // routes.tsx pour /host/:sessionId, /play et /join (voir brief Task B1).
  it('pose data-theme="scene" data-scheme="dark" autour du contenu', () => {
    const { container } = render(
      <SceneRoute>
        <p>x</p>
      </SceneRoute>,
    )
    expect(
      container.querySelector('[data-theme="scene"][data-scheme="dark"]'),
    ).not.toBeNull()
  })
})
