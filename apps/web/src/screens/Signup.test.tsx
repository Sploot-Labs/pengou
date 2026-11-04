// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})
const mockSignUp = vi.fn()
vi.mock('../api/auth', () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  useSession: () => ({ refresh: vi.fn() }),
}))

import { Signup } from './Signup'

function renderSignup(path = '/signup') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Signup />
    </MemoryRouter>,
  )
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Camille' } })
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'camille@example.com' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'motdepasse1' } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'motdepasse1' } })
  fireEvent.click(screen.getByRole('button', { name: "S'inscrire" }))
}

describe('Signup', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("propose la correction du domaine à la perte de focus et l'applique", () => {
    renderSignup()
    const email = screen.getByLabelText('E-mail')
    fireEvent.change(email, { target: { value: 'camille@gmial.com' } })
    expect(screen.queryByRole('button', { name: 'camille@gmail.com' })).not.toBeInTheDocument()
    fireEvent.blur(email)
    fireEvent.click(screen.getByRole('button', { name: 'camille@gmail.com' }))
    expect(email).toHaveValue('camille@gmail.com')
  })

  it("revient sur la destination ?next= après l'inscription et la propage au lien de connexion", async () => {
    mockSignUp.mockResolvedValue({})
    renderSignup('/signup?next=%2Finvitations%2Fabc%3Fv%3Dxyz')
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute(
      'href',
      '/login?next=%2Finvitations%2Fabc%3Fv%3Dxyz',
    )
    fillAndSubmit()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/invitations/abc?v=xyz', { replace: true }))
  })

  it('ignore une destination ?next= externe', async () => {
    mockSignUp.mockResolvedValue({})
    renderSignup('/signup?next=%2F%2Fevil.example')
    fillAndSubmit()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
