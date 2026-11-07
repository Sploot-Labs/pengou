// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalInfo } from '../api/legal'

const mockSignUp = vi.fn()
const mockRefresh = vi.fn()
vi.mock('../api/auth', () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  useSession: () => ({ refresh: mockRefresh }),
}))

const mockFetchLegal = vi.fn<() => Promise<LegalInfo>>()
vi.mock('../api/legal', async () => {
  const actual = await vi.importActual<typeof import('../api/legal')>('../api/legal')
  return { ...actual, fetchLegal: () => mockFetchLegal() }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { Signup } from './Signup'

const LEGAL: LegalInfo = {
  termsVersion: '2026-10-31',
  termsUrl: 'https://pengou.fr/cgu/',
  privacyUrl: 'https://pengou.fr/politique-de-confidentialite/',
}

function renderSignup(path = '/signup') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Signup />
    </MemoryRouter>,
  )
}

function fillValidFields() {
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'motdepasse-1' } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'motdepasse-1' } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: "S'inscrire" }))
}

beforeEach(() => {
  mockSignUp.mockResolvedValue({ id: 'u1', email: 'ada@example.com' })
  mockRefresh.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Signup avec CGU activées', () => {
  beforeEach(() => mockFetchLegal.mockResolvedValue(LEGAL))

  it('affiche deux cases distinctes, non cochées, avec un vrai label', async () => {
    renderSignup()
    const age = await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })
    const terms = screen.getByRole('checkbox', { name: /J'accepte les conditions d'utilisation/ })
    expect(age).not.toBeChecked()
    expect(terms).not.toBeChecked()
    expect(age).not.toBe(terms)
  })

  it("ouvre les CGU et la politique dans un nouvel onglet, signalé dans l'intitulé accessible", async () => {
    renderSignup()
    const termsLink = await screen.findByRole('link', { name: "conditions d'utilisation (s'ouvre dans un nouvel onglet)" })
    expect(termsLink).toHaveAttribute('href', LEGAL.termsUrl)
    expect(termsLink).toHaveAttribute('target', '_blank')
    expect(termsLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
    const privacyLink = screen.getByRole('link', { name: "politique de confidentialité (s'ouvre dans un nouvel onglet)" })
    expect(privacyLink).toHaveAttribute('href', LEGAL.privacyUrl)
    expect(privacyLink).toHaveAttribute('target', '_blank')
  })

  it("informe sur la politique de confidentialité sans case à cocher", async () => {
    renderSignup()
    const sentence = await screen.findByText(/explique comment vos données sont traitées/)
    expect(sentence.closest('p')).toHaveTextContent(
      "La politique de confidentialité (s'ouvre dans un nouvel onglet) explique comment vos données sont traitées.",
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it("refuse l'envoi sans la case d'âge : erreur reliée par aria-describedby et focus sur la case", async () => {
    renderSignup()
    const age = await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })
    fillValidFields()
    fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions/ }))
    submit()
    expect(mockSignUp).not.toHaveBeenCalled()
    expect(age).toHaveFocus()
    expect(age).toHaveAttribute('aria-invalid', 'true')
    expect(age).toHaveAccessibleDescription('Confirmez que vous avez 15 ans ou plus.')
  })

  it("refuse l'envoi sans accepter les CGU : erreur reliée et focus sur la case", async () => {
    renderSignup()
    fireEvent.click(await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" }))
    fillValidFields()
    submit()
    const terms = screen.getByRole('checkbox', { name: /J'accepte les conditions/ })
    expect(mockSignUp).not.toHaveBeenCalled()
    expect(terms).toHaveFocus()
    expect(terms).toHaveAccessibleDescription("Acceptez les conditions d'utilisation pour créer votre compte.")
  })

  it('garde la validation champ par champ : le focus va à la première erreur du formulaire', async () => {
    renderSignup()
    await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })
    submit()
    expect(screen.getByLabelText('Nom')).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: "J'ai 15 ans ou plus" })).toHaveAccessibleDescription(
      'Confirmez que vous avez 15 ans ou plus.',
    )
  })

  it("efface l'erreur d'une case dès qu'elle est cochée", async () => {
    renderSignup()
    const age = await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })
    fillValidFields()
    submit()
    expect(age).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(age)
    expect(age).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Confirmez que vous avez 15 ans ou plus.')).not.toBeInTheDocument()
  })

  it('les cases se cochent au clavier (barre d\'espace sur une case native)', async () => {
    renderSignup()
    const age = await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })
    expect(age.tagName).toBe('INPUT')
    expect(age).toHaveAttribute('type', 'checkbox')
    expect(age).not.toHaveAttribute('tabindex', '-1')
  })

  it('envoie la version affichée et la confirmation d\'âge quand tout est coché', async () => {
    renderSignup()
    fireEvent.click(await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" }))
    fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions/ }))
    fillValidFields()
    submit()
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1))
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'motdepasse-1',
      name: 'Ada',
      acceptedTermsVersion: '2026-10-31',
      ageConfirmed: true,
    })
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})

describe('Signup avec CGU désactivées (instance auto-hébergée)', () => {
  beforeEach(() => mockFetchLegal.mockResolvedValue({ termsVersion: null, termsUrl: null, privacyUrl: null }))

  it("reste comme aujourd'hui : aucune case, aucune mention", async () => {
    renderSignup()
    await waitFor(() => expect(screen.getByRole('button', { name: "S'inscrire" })).toBeEnabled())
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText(/politique de confidentialité/)).not.toBeInTheDocument()
    fillValidFields()
    submit()
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'motdepasse-1', name: 'Ada' }))
  })
})

describe('Signup quand la configuration légale ne se charge pas', () => {
  it("bloque l'envoi et propose de réessayer", async () => {
    mockFetchLegal.mockRejectedValueOnce(new Error('réseau')).mockResolvedValueOnce(LEGAL)
    renderSignup()
    expect(await screen.findByText(/Impossible de charger les conditions d'utilisation/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "S'inscrire" })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })).toBeInTheDocument()
  })
})

describe("Signup, aide à la saisie de l'e-mail et destination ?next=", () => {
  beforeEach(() => mockFetchLegal.mockResolvedValue({ termsVersion: null, termsUrl: null, privacyUrl: null }))

  async function fillAndSubmit() {
    await waitFor(() => expect(screen.getByRole('button', { name: "S'inscrire" })).toBeEnabled())
    fillValidFields()
    submit()
  }

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
    renderSignup('/signup?next=%2Finvitations%2Fabc%3Fv%3Dxyz')
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute(
      'href',
      '/login?next=%2Finvitations%2Fabc%3Fv%3Dxyz',
    )
    await fillAndSubmit()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/invitations/abc?v=xyz', { replace: true }))
  })

  it('ignore une destination ?next= externe', async () => {
    renderSignup('/signup?next=%2F%2Fevil.example')
    await fillAndSubmit()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
