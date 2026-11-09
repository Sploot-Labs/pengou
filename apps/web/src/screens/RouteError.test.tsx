// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteError } from './RouteError'

function Boom(): never {
  throw new Error('boom')
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <p>Accueil</p> },
          { path: '/boom', element: <Boom /> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RouteError', () => {
  it("annonce une page inexistante en français, avec un retour à l'accueil", () => {
    renderAt('/nulle-part')
    expect(screen.getByRole('alert').textContent).toBe("Cette page n'existe pas.")
    expect(screen.getByRole('link', { name: /Retour à l'accueil/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Recharger la page' })).toBeNull()
  })

  it('remplace la page de développement de react-router quand un écran lève', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderAt('/boom')
    expect(screen.getByRole('alert').textContent).toMatch(/Une erreur inattendue est survenue/)
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeTruthy()
  })
})
