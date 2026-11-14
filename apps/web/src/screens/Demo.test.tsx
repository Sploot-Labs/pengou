// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { setLang } from '../i18n/lang'
import type { LegalInfo } from '../api/legal'

const mockStartDemo = vi.fn()
vi.mock('../api/demo', async () => {
  const actual = await vi.importActual<typeof import('../api/demo')>('../api/demo')
  return { ...actual, startDemo: (...args: unknown[]) => mockStartDemo(...args) }
})

const mockRefresh = vi.fn()
let sessionUser: { id: string; isAnonymous?: boolean } | null = null
vi.mock('../api/auth', () => ({
  useSession: () => ({ user: sessionUser, loading: false, refresh: mockRefresh }),
}))

const mockFetchLegal = vi.fn<() => Promise<LegalInfo>>()
vi.mock('../api/legal', async () => {
  const actual = await vi.importActual<typeof import('../api/legal')>('../api/legal')
  return { ...actual, fetchLegal: () => mockFetchLegal() }
})

let features = { mailEnabled: false, demoEnabled: true, demoMaxPlayers: 30, loading: false }
vi.mock('../api/features', () => ({
  useAuthFeatures: () => features,
}))

const mockSetActiveTenantId = vi.fn()
vi.mock('../api/activeTenant', () => ({
  setActiveTenantId: (...args: unknown[]) => mockSetActiveTenantId(...args),
}))

const mockLaunch = vi.fn()
vi.mock('../realtime/useLaunchGame', () => ({
  useLaunchGame: () => ({ launch: mockLaunch, launching: false, error: null }),
}))

const mockReconnect = vi.fn()
vi.mock('../realtime/GameSocketProvider', () => ({
  useSharedGameSocket: () => ({ reconnect: mockReconnect }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { Demo } from './Demo'

const LEGAL: LegalInfo = {
  termsVersion: '2026-10-31',
  termsUrl: 'https://pengou.fr/cgu/',
  privacyUrl: 'https://pengou.fr/politique-de-confidentialite/',
}
const NO_LEGAL: LegalInfo = { termsVersion: null, termsUrl: null, privacyUrl: null }
const STARTED = { quizId: 'quiz-1', tenantId: 'tenant-1', liveSessionId: null }

function renderDemo(path = '/demo') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Demo />
    </MemoryRouter>,
  )
}

const launchButton = () => screen.findByRole('button', { name: 'Lancer la démonstration' })
const ageBox = () => screen.findByRole('checkbox', { name: "J'ai 15 ans ou plus" })

beforeEach(() => {
  sessionUser = null
  features = { mailEnabled: false, demoEnabled: true, demoMaxPlayers: 30, loading: false }
  mockFetchLegal.mockResolvedValue(LEGAL)
  mockStartDemo.mockResolvedValue(STARTED)
  mockRefresh.mockResolvedValue(undefined)
  mockLaunch.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  setLang('fr')
  vi.clearAllMocks()
})

describe('écran /demo', () => {
  it("affiche la promesse, la case d'âge non cochée, le lien des conditions et le bouton", async () => {
    renderDemo()
    expect(screen.getByRole('heading', { level: 1, name: 'Essayez Pengou sans créer de compte' })).toBeInTheDocument()
    expect(
      screen.getByText(
        "Une vraie partie du quiz d'exemple, jusqu'à 30 joueurs. Rien n'est conservé après la démonstration.",
      ),
    ).toBeInTheDocument()
    expect(await ageBox()).not.toBeChecked()
    expect(screen.getByText(/En lançant la démonstration, vous acceptez les/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /conditions d'utilisation/ })).toHaveAttribute('href', LEGAL.termsUrl)
    expect(await launchButton()).toBeEnabled()
  })

  it("propose le sélecteur de langue, qui retraduit l'écran", async () => {
    renderDemo()
    const select = screen.getByRole('combobox', { name: "Langue de l'interface" })
    act(() => {
      fireEvent.change(select, { target: { value: 'en' } })
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Try Pengou without creating an account' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Start the demo' })).toBeEnabled()
  })

  it("annonce le plafond de joueurs réel de l'instance", async () => {
    features = { ...features, demoMaxPlayers: 12 }
    renderDemo()
    expect(screen.getByText(/jusqu'à 12 joueurs/)).toBeInTheDocument()
  })

  it("ne lance rien tant que la case d'âge n'est pas cochée", async () => {
    renderDemo()
    fireEvent.click(await launchButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirmez que vous avez 15 ans ou plus.')
    expect(mockStartDemo).not.toHaveBeenCalled()
    expect(await ageBox()).toHaveFocus()
  })

  it('lance la partie puis ouvre le salon', async () => {
    renderDemo('/demo?from=Accueil')
    fireEvent.click(await ageBox())
    fireEvent.click(await launchButton())

    await waitFor(() => expect(mockLaunch).toHaveBeenCalledWith('quiz-1', 'Quiz de démonstration'))
    expect(mockStartDemo).toHaveBeenCalledWith({
      ageConfirmed: true,
      acceptedTermsVersion: '2026-10-31',
      from: 'accueil',
    })
    expect(mockSetActiveTenantId).toHaveBeenCalledWith('tenant-1')
    expect(mockRefresh).toHaveBeenCalled()
    // L'espace actif et la session sont en place, puis la socket refait sa poignée de main (elle
    // s'était connectée sans cookie de session), avant le lancement de la partie.
    const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0]
    expect(order(mockSetActiveTenantId)).toBeLessThan(order(mockReconnect))
    expect(order(mockRefresh)).toBeLessThan(order(mockLaunch))
    expect(order(mockReconnect)).toBeLessThan(order(mockLaunch))
  })

  it("reprend la partie vivante au lieu d'en créer une", async () => {
    mockStartDemo.mockResolvedValue({ ...STARTED, liveSessionId: 'session-9' })
    renderDemo()
    fireEvent.click(await ageBox())
    fireEvent.click(await launchButton())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/host/session-9'))
    expect(mockLaunch).not.toHaveBeenCalled()
    // Second onglet : sa socket s'était connectée sans le cookie de l'invité. Elle refait sa poignée
    // de main avant l'écran hôte, sinon la reprise serait refusée (« authentification requise »).
    expect(mockReconnect).toHaveBeenCalledTimes(1)
    expect(mockReconnect.mock.invocationCallOrder[0]).toBeLessThan(mockNavigate.mock.invocationCallOrder[0])
  })

  it("n'appelle le serveur qu'une fois sur un double clic", async () => {
    let release: (value: typeof STARTED) => void = () => {}
    mockStartDemo.mockReturnValue(new Promise((resolve) => (release = resolve)))
    renderDemo()
    fireEvent.click(await ageBox())
    const button = await launchButton()
    fireEvent.click(button)
    fireEvent.click(button)
    release(STARTED)

    await waitFor(() => expect(mockLaunch).toHaveBeenCalledTimes(1))
    expect(mockStartDemo).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'DEMO_FULL',
      503,
      'La démonstration est très demandée en ce moment. Créez un compte gratuit pour lancer votre quiz tout de suite.',
    ],
    [
      'DEMO_RATE_LIMITED',
      429,
      'Trop de démonstrations lancées depuis votre réseau. Réessayez dans une heure, ou créez un compte gratuit.',
    ],
  ])("affiche le message du serveur et le lien vers l'inscription sur %s", async (code, status, message) => {
    mockStartDemo.mockRejectedValue(new ApiError(status, message, code))
    renderDemo()
    fireEvent.click(await ageBox())
    fireEvent.click(await launchButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('link', { name: 'Créer un compte gratuit' })).toHaveAttribute('href', '/signup?from=demo')
    expect(await launchButton()).toBeEnabled()
  })

  it('reste sans case sur une instance sans conditions publiées', async () => {
    mockFetchLegal.mockResolvedValue(NO_LEGAL)
    renderDemo()
    fireEvent.click(await launchButton())

    await waitFor(() => expect(mockLaunch).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(mockStartDemo).toHaveBeenCalledWith({ ageConfirmed: true, acceptedTermsVersion: undefined, from: undefined })
  })

  it("explique que la démonstration n'existe pas ici quand elle est éteinte", async () => {
    features = { ...features, demoEnabled: false }
    renderDemo()
    expect(screen.getByText("La démonstration n'est pas disponible sur cette instance.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lancer la démonstration' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Créer un compte gratuit' })).toHaveAttribute('href', '/signup?from=demo')
  })

  it('renvoie un compte ordinaire déjà connecté vers son espace', async () => {
    sessionUser = { id: 'u1', isAnonymous: false }
    renderDemo()
    expect(screen.getByRole('link', { name: 'Ouvrir mon espace' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'Lancer la démonstration' })).not.toBeInTheDocument()
  })

  it('laisse un invité déjà connecté relancer sa démonstration', async () => {
    sessionUser = { id: 'g1', isAnonymous: true }
    renderDemo()
    fireEvent.click(await ageBox())
    fireEvent.click(await launchButton())
    await waitFor(() => expect(mockLaunch).toHaveBeenCalled())
  })
})
