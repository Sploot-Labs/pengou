// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Login } from './Login'

let mailEnabled = false
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../api/features', () => ({
  useAuthFeatures: () => ({ mailEnabled, loading: false }),
}))
vi.mock('../api/auth', () => ({
  signIn: vi.fn(() => Promise.resolve({})),
  useSession: () => ({ refresh: vi.fn() }),
}))

function renderLogin(state?: unknown, search = '') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', search, state }]}>
      <Login />
    </MemoryRouter>,
  )
}

describe('Login', () => {
  afterEach(cleanup)

  it("affiche « Mot de passe oublié ? » quand l'envoi d'e-mail est activé", () => {
    mailEnabled = true
    renderLogin()
    expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it("masque le lien quand l'envoi d'e-mail est désactivé", () => {
    mailEnabled = false
    renderLogin()
    expect(screen.queryByRole('link', { name: 'Mot de passe oublié ?' })).not.toBeInTheDocument()
  })

  it('confirme le changement de mot de passe après une réinitialisation', () => {
    mailEnabled = false
    renderLogin({ passwordReset: true })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mot de passe modifié. Vous pouvez vous connecter.',
    )
  })

  function connecter() {
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'camille@example.com' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'motdepasse1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  }

  it('revient sur la destination ?next= après la connexion', async () => {
    renderLogin(undefined, '?next=%2Finvitations%2Fabc%3Fv%3Dxyz')
    expect(screen.getByRole('link', { name: 'Créer un compte' })).toHaveAttribute(
      'href',
      '/signup?next=%2Finvitations%2Fabc%3Fv%3Dxyz',
    )
    connecter()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/invitations/abc?v=xyz', { replace: true }))
  })

  it('ignore une destination externe', async () => {
    mockNavigate.mockClear()
    renderLogin(undefined, '?next=https%3A%2F%2Fevil.example')
    connecter()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
