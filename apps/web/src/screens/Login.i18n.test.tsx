// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
import { Login } from './Login'

vi.mock('../api/auth', () => ({
  signIn: vi.fn(),
  useSession: () => ({ refresh: vi.fn() }),
}))
vi.mock('../api/features', () => ({
  useAuthFeatures: () => ({ mailEnabled: true, loading: false }),
}))

// Sans `globals`, React Testing Library ne démonte pas seul : un composant resté monté en en/es
// se réaffiche hors act quand la langue est remise à zéro.
afterEach(cleanup)

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

describe('Login traduit', () => {
  it('affiche les libellés en anglais', () => {
    act(() => setLang('en'))
    renderLogin()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('affiche les libellés en espagnol', () => {
    act(() => setLang('es'))
    renderLogin()
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('se retraduit au changement de langue via le sélecteur', () => {
    renderLogin()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    act(() => setLang('es'))
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument()
    expect(screen.getByLabelText('Idioma de la interfaz')).toBeInTheDocument()
  })
})
