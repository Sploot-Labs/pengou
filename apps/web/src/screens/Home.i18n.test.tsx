// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
import { MotionProvider } from '../motion/index.js'
import { Home } from './Home'

vi.mock('../api/quizzes', () => ({
  listQuizzes: vi.fn(() =>
    Promise.resolve([
      { id: 'q1', title: 'Culture G', description: null, updatedAt: '2026-07-20T15:30:00Z', questionCount: 5 },
    ]),
  ),
  createQuiz: vi.fn(),
  createExampleQuiz: vi.fn(),
  archiveQuiz: vi.fn(),
  restoreQuiz: vi.fn(),
}))
vi.mock('../api/sessions', () => ({
  listSessions: vi.fn(() =>
    Promise.resolve([
      {
        id: 's1',
        pin: '123456',
        status: 'ended',
        startedAt: '2026-07-20T10:00:00.000Z',
        endedAt: '2026-07-20T10:30:00.000Z',
        quizId: 'q1',
        quizTitle: 'Partie 1',
        playerCount: 0,
      },
    ]),
  ),
}))
vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn(), user: { email: 'camille@example.com', emailVerified: true } }),
  sendVerificationEmail: vi.fn(),
}))
vi.mock('../realtime/GameSocketProvider', () => ({
  useSharedGameSocket: () => ({ emitAck: vi.fn(), connected: true, socket: {}, on: vi.fn() }),
}))

// Sans `globals`, React Testing Library ne démonte pas seul : un écran resté monté en en/es se
// réaffiche hors act quand la langue est remise à zéro.
afterEach(cleanup)

function renderHome() {
  return render(
    <MotionProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </MotionProvider>,
  )
}

describe('Home traduit', () => {
  it("affiche l'accueil en espagnol, avec pluriel et dates localisés", async () => {
    act(() => setLang('es'))
    renderHome()
    expect(screen.getByRole('heading', { name: 'Hola' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Nuevo quiz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
    expect(screen.getByText(/5 preguntas/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/PIN 123456, .*, 0 jugadores/)[0]).toBeInTheDocument())
    expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0)
  })

  it("affiche l'accueil en anglais", async () => {
    act(() => setLang('en'))
    renderHome()
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New quiz' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/PIN 123456, .*, 0 players/)[0]).toBeInTheDocument())
    expect(screen.getByText(/5 questions/)).toBeInTheDocument()
  })
})
