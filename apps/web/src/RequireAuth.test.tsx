// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockSession = vi.fn()
vi.mock('./api/auth', () => ({
  useSession: () => mockSession(),
  signOut: vi.fn(),
}))
vi.mock('./api/workspace-context', () => ({ useWorkspaces: () => ({ ready: true }) }))
vi.mock('./screens/TermsRevalidation', () => ({
  TermsRevalidation: () => <h1>Écran de revalidation</h1>,
}))

import { RequireAuth } from './RequireAuth'

function session(termsAcceptanceRequired: boolean) {
  return {
    user: { id: 'u1', email: 'hote@example.com' },
    loading: false,
    error: null,
    refresh: vi.fn(),
    termsAcceptanceRequired,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RequireAuth et revalidation des CGU', () => {
  it("affiche l'écran bloquant à la place de l'écran protégé", () => {
    mockSession.mockReturnValue(session(true))
    render(
      <MemoryRouter>
        <RequireAuth>
          <p>Contenu protégé</p>
        </RequireAuth>
      </MemoryRouter>,
    )
    expect(screen.getByText('Écran de revalidation')).toBeInTheDocument()
    expect(screen.queryByText('Contenu protégé')).not.toBeInTheDocument()
  })

  it('rend le contenu quand les CGU courantes sont acceptées', () => {
    mockSession.mockReturnValue(session(false))
    render(
      <MemoryRouter>
        <RequireAuth>
          <p>Contenu protégé</p>
        </RequireAuth>
      </MemoryRouter>,
    )
    expect(screen.getByText('Contenu protégé')).toBeInTheDocument()
  })

  it("ne coupe pas une partie en cours (écran hôte live) : l'écran viendra à la navigation suivante", () => {
    mockSession.mockReturnValue(session(true))
    render(
      <MemoryRouter>
        <RequireAuth allowPendingTerms>
          <p>Partie en cours</p>
        </RequireAuth>
      </MemoryRouter>,
    )
    expect(screen.getByText('Partie en cours')).toBeInTheDocument()
  })
})
