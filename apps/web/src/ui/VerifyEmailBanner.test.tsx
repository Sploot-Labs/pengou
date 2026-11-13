// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let user: { email: string; emailVerified: boolean; isAnonymous?: boolean } | null = null
let mailEnabled = true
const refresh = vi.fn()
const sendVerificationEmail = vi.fn()

vi.mock('../api/features', () => ({ useAuthFeatures: () => ({ mailEnabled, loading: false }) }))
vi.mock('../api/auth', () => ({
  useSession: () => ({ user, refresh }),
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}))

import { VerifyEmailBanner } from './VerifyEmailBanner'

const TEXT = "Confirmez votre adresse pour créer plus d'un quiz."

function renderBanner(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmailBanner />
    </MemoryRouter>,
  )
}

describe('VerifyEmailBanner', () => {
  beforeEach(() => {
    user = { email: 'camille@example.com', emailVerified: false }
    mailEnabled = true
    refresh.mockReset()
    sendVerificationEmail.mockReset()
    sendVerificationEmail.mockResolvedValue(undefined)
    sessionStorage.clear()
  })
  afterEach(cleanup)

  it("s'affiche pour un compte non confirmé quand l'envoi d'e-mail est activé", () => {
    renderBanner()
    expect(screen.getByText(TEXT)).toBeInTheDocument()
  })

  it.each([
    [
      'envoi désactivé',
      () => {
        mailEnabled = false
      },
    ],
    [
      'compte confirmé',
      () => {
        user = { email: 'a@b.fr', emailVerified: true }
      },
    ],
    [
      'hôte invité de la démonstration',
      () => {
        user = { email: 'temp-g1@invite.invalid', emailVerified: false, isAnonymous: true }
      },
    ],
    [
      'sans session',
      () => {
        user = null
      },
    ],
  ])('est absent : %s', (_label, setup) => {
    setup()
    renderBanner()
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
  })

  it('est absent sur un écran de jeu', () => {
    renderBanner('/host/abc')
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
  })

  it("« Renvoyer l'e-mail » appelle l'API puis annonce « E-mail envoyé »", async () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: "Renvoyer l'e-mail" }))
    await waitFor(() => expect(screen.getByText('E-mail envoyé')).toBeInTheDocument())
    expect(sendVerificationEmail).toHaveBeenCalledWith('camille@example.com')
    expect(screen.getByText('E-mail envoyé').closest('[role="status"]')).not.toBeNull()
  })

  it("affiche l'erreur quand le renvoi échoue", async () => {
    sendVerificationEmail.mockRejectedValue(new Error('boom'))
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: "Renvoyer l'e-mail" }))
    expect(await screen.findByRole('alert')).toHaveTextContent("L'e-mail n'a pas pu partir")
  })

  it('la fermeture est mémorisée pour la session', () => {
    const first = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('pengou:verify-banner-dismissed')).toBe('1')
    first.unmount()
    renderBanner()
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
  })

  it('?email-verifie=1 confirme et rafraîchit la session', async () => {
    renderBanner('/?email-verifie=1')
    expect(await screen.findByText('Adresse e-mail confirmée.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
