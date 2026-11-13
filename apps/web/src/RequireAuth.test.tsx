// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

describe('RequireAuth et hôte invité de la démonstration', () => {
  const guest = () => ({ ...session(false), user: { id: 'g1', email: 'temp-g1@invite.invalid', isAnonymous: true } })

  function renderAt(element: React.ReactNode) {
    return render(
      <MemoryRouter initialEntries={['/protege']}>
        <Routes>
          <Route path="/protege" element={element} />
          <Route path="/demo" element={<h1>Écran de démonstration</h1>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it("ramène l'invité à /demo sur un écran qui ne lui est pas ouvert", () => {
    mockSession.mockReturnValue(guest())
    renderAt(
      <RequireAuth>
        <p>Éditeur</p>
      </RequireAuth>,
    )
    expect(screen.getByText('Écran de démonstration')).toBeInTheDocument()
    expect(screen.queryByText('Éditeur')).not.toBeInTheDocument()
  })

  it("laisse l'invité sur l'écran hôte de sa partie", () => {
    mockSession.mockReturnValue(guest())
    renderAt(
      <RequireAuth allowGuest>
        <p>Partie de démonstration</p>
      </RequireAuth>,
    )
    expect(screen.getByText('Partie de démonstration')).toBeInTheDocument()
  })

  it('ne change rien pour un compte ordinaire', () => {
    mockSession.mockReturnValue(session(false))
    renderAt(
      <RequireAuth>
        <p>Éditeur</p>
      </RequireAuth>,
    )
    expect(screen.getByText('Éditeur')).toBeInTheDocument()
  })
})
