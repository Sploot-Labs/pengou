// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { LegalInfo } from '../api/legal'

const mockSignOut = vi.fn()
const mockRefresh = vi.fn()
vi.mock('../api/auth', () => ({
  signOut: () => mockSignOut(),
  useSession: () => ({ refresh: mockRefresh }),
}))

const mockFetchLegal = vi.fn<() => Promise<LegalInfo>>()
const mockAcceptTerms = vi.fn()
vi.mock('../api/legal', async () => {
  const actual = await vi.importActual<typeof import('../api/legal')>('../api/legal')
  return { ...actual, fetchLegal: () => mockFetchLegal(), acceptTerms: (v: string) => mockAcceptTerms(v) }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { TermsRevalidation } from './TermsRevalidation'

const LEGAL: LegalInfo = {
  termsVersion: '2026-10-31',
  termsUrl: 'https://pengou.fr/cgu/',
  privacyUrl: 'https://pengou.fr/politique-de-confidentialite/',
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <TermsRevalidation />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockFetchLegal.mockResolvedValue(LEGAL)
  mockAcceptTerms.mockResolvedValue({ termsVersion: LEGAL.termsVersion })
  mockRefresh.mockResolvedValue(undefined)
  mockSignOut.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TermsRevalidation', () => {
  it('place le focus sur le titre et annonce la date de la nouvelle version', async () => {
    renderScreen()
    const heading = await screen.findByRole('heading', { level: 1, name: "Les conditions d'utilisation ont changé" })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText(/31 octobre 2026/)).toBeInTheDocument()
  })

  it('propose le lien vers les CGU dans un nouvel onglet, signalé', async () => {
    renderScreen()
    const link = await screen.findByRole('link', { name: /conditions d'utilisation \(s'ouvre dans un nouvel onglet\)/ })
    expect(link).toHaveAttribute('href', LEGAL.termsUrl)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('refuse sans case cochée : erreur reliée par aria-describedby, focus sur la case', async () => {
    renderScreen()
    const box = await screen.findByRole('checkbox', { name: "J'accepte les conditions d'utilisation" })
    expect(box).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Accepter et continuer' }))
    expect(mockAcceptTerms).not.toHaveBeenCalled()
    expect(box).toHaveFocus()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription("Cochez la case pour accepter les conditions d'utilisation.")
  })

  it('accepte la version affichée puis relit la session', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('checkbox', { name: "J'accepte les conditions d'utilisation" }))
    fireEvent.click(screen.getByRole('button', { name: 'Accepter et continuer' }))
    await waitFor(() => expect(mockAcceptTerms).toHaveBeenCalledWith('2026-10-31'))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it('recharge la version si les CGU ont encore changé (409) et demande une nouvelle lecture', async () => {
    mockAcceptTerms.mockRejectedValueOnce(
      new ApiError(
        409,
        "Les conditions d'utilisation ont encore changé. Rechargez la page pour lire la dernière version.",
        'TERMS_VERSION_MISMATCH',
      ),
    )
    mockFetchLegal.mockResolvedValueOnce(LEGAL).mockResolvedValueOnce({ ...LEGAL, termsVersion: '2026-12-01' })
    renderScreen()
    fireEvent.click(await screen.findByRole('checkbox', { name: "J'accepte les conditions d'utilisation" }))
    fireEvent.click(screen.getByRole('button', { name: 'Accepter et continuer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ont encore changé/)
    expect(await screen.findByText(/1 décembre 2026|1er décembre 2026/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: "J'accepte les conditions d'utilisation" })).not.toBeChecked()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('permet de se déconnecter', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }))
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'))
  })
})
