// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetPassword } from './ResetPassword'

const fetchMock = vi.fn()

function LoginProbe() {
  const location = useLocation()
  return <p>Page de connexion {JSON.stringify(location.state)}</p>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/forgot-password" element={<p>Page mot de passe oublié</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fill(pwd: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: pwd } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
}

describe('ResetPassword', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([['/reset-password'], ['/reset-password?error=INVALID_TOKEN']])(
    'affiche « lien expiré » sans token valide (%s)',
    (url) => {
      renderAt(url)
      expect(screen.getByText('Ce lien a expiré ou a déjà servi.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /nouvelle demande/i })).toHaveAttribute(
        'href',
        '/forgot-password',
      )
      expect(screen.queryByLabelText('Nouveau mot de passe')).not.toBeInTheDocument()
    },
  )

  it('signale des mots de passe différents sur le champ de confirmation', () => {
    renderAt('/reset-password?token=abc')
    fill('motdepasse1', 'motdepasse2')
    expect(screen.getByLabelText('Confirmer le mot de passe')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Les mots de passe ne correspondent pas.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuse un mot de passe trop court', () => {
    renderAt('/reset-password?token=abc')
    fill('court', 'court')
    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('envoie le token et le mot de passe, puis navigue vers la connexion avec un message', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: true }), { status: 200 }))
    renderAt('/reset-password?token=abc')
    fill('motdepasse1', 'motdepasse1')
    expect(await screen.findByText(/Page de connexion/)).toHaveTextContent('passwordReset')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/reset-password')
    expect(JSON.parse(init.body)).toEqual({ newPassword: 'motdepasse1', token: 'abc' })
  })

  it('traite un refus 400 comme un lien expiré', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid token' }), { status: 400 }),
    )
    renderAt('/reset-password?token=abc')
    fill('motdepasse1', 'motdepasse1')
    expect(await screen.findByText('Ce lien a expiré ou a déjà servi.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /nouvelle demande/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})
