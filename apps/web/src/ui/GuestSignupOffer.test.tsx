// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockSignOut = vi.fn()
const mockRefresh = vi.fn()
type Session = {
  user: { id: string; email?: string; isAnonymous?: boolean } | null
  loading: boolean
  error: null
  refresh: () => Promise<void>
  termsAcceptanceRequired: boolean
}
let session: Session | null = null
vi.mock('../api/auth', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSessionOptional: () => session,
  useSession: () => session,
}))
vi.mock('../api/workspace-context', () => ({ useWorkspaces: () => ({ ready: true }) }))

import { RequireAuth } from '../RequireAuth'
import { GuestSignupOffer } from './GuestSignupOffer'

const OFFER = 'Créer mon compte pour faire mes propres quiz'
const as = (user: Session['user']): Session => ({
  user,
  loading: false,
  error: null,
  refresh: mockRefresh,
  termsAcceptanceRequired: false,
})

function renderOffer() {
  return render(
    <MemoryRouter>
      <GuestSignupOffer />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  session = null
})

describe("offre d'inscription à l'hôte invité", () => {
  it("propose à l'invité de créer son compte, en disant que rien n'est conservé", () => {
    session = as({ id: 'g1', isAnonymous: true })
    renderOffer()
    expect(screen.getByRole('link', { name: OFFER })).toHaveAttribute('href', '/signup?from=demo')
    expect(screen.getByText(/rien n'est conservé/)).toBeInTheDocument()
  })

  // Fermer la session de l'invité avant de naviguer le renvoyait à la connexion : l'écran hôte,
  // protégé, redirigeait vers /login dès que la session disparaissait, avant l'arrivée sur /signup.
  it("mène de l'écran hôte protégé à l'inscription, sans fermer la session ni passer par la connexion", () => {
    session = as({ id: 'g1', email: 'temp-g1@invite.invalid', isAnonymous: true })
    render(
      <MemoryRouter initialEntries={['/host/s1']}>
        <Routes>
          <Route
            path="/host/:sessionId"
            element={
              <RequireAuth allowGuest>
                <GuestSignupOffer />
              </RequireAuth>
            }
          />
          <Route path="/signup" element={<h1>Écran d'inscription</h1>} />
          <Route path="/login" element={<h1>Écran de connexion</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: OFFER }))

    expect(screen.getByText("Écran d'inscription")).toBeInTheDocument()
    expect(screen.queryByText('Écran de connexion')).not.toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it.each([
    ['un compte ordinaire', as({ id: 'u1', isAnonymous: false })],
    ['une session absente', as(null)],
    ['un écran sans fournisseur de session', null],
  ])('ne montre rien pour %s', (_label, value) => {
    session = value
    renderOffer()
    expect(screen.queryByRole('link', { name: OFFER })).not.toBeInTheDocument()
  })
})
