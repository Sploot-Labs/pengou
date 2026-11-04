// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Login } from './Login'

let mailEnabled = false

vi.mock('../api/features', () => ({
  useAuthFeatures: () => ({ mailEnabled, loading: false }),
}))
vi.mock('../api/auth', () => ({
  signIn: vi.fn(),
  useSession: () => ({ refresh: vi.fn() }),
}))

function renderLogin(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
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
})
