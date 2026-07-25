// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import type { SessionStatus, SessionSummary } from '../api/sessions'

vi.mock('../api/quizzes', () => ({
  listQuizzes: vi.fn(() =>
    Promise.resolve([
      { id: 'q1', title: 'Culture G', description: null, updatedAt: '2026-07-20T15:30:00Z', questionCount: 5 },
    ]),
  ),
  createQuiz: vi.fn(),
}))
vi.mock('../api/sessions', () => ({ listSessions: vi.fn(() => Promise.resolve([])) }))
vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn() }),
}))

// `Home` now calls `useLaunchGame` (Task 7), which itself calls `useSharedGameSocket` — mocked
// here rather than rendered under a real `<GameSocketProvider>` so the suite never opens an
// actual `socket.io-client` connection. `emitAck`'s resolved value is set per-test below.
// Names are prefixed `mock` deliberately — Vitest only allows referencing
// outer-scope variables inside a hoisted `vi.mock` factory when they start
// with that prefix (otherwise: "cannot access '...' before initialization").
const mockEmitAck = vi.fn()
vi.mock('../realtime/GameSocketProvider', () => ({
  useSharedGameSocket: () => ({ emitAck: mockEmitAck, connected: true, socket: {}, on: vi.fn() }),
}))

// Only `useNavigate` is faked — everything else (MemoryRouter, Link, …) stays real so the
// existing link-based assertions (e.g. the card's `href`) keep working unmodified.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { Home } from './Home'

/** 12 sessions of varied statuses — enough to exercise both the 8-row
 * limit and the status filter without depending on real API data. */
function makeSessions(): SessionSummary[] {
  const statuses: SessionStatus[] = [
    'ended', 'ended', 'ended', 'ended', 'ended',
    'active', 'active', 'active',
    'lobby', 'lobby', 'lobby', 'lobby',
  ]
  return statuses.map((status, i) => ({
    id: `s${i}`,
    pin: String(100000 + i),
    status,
    startedAt: status === 'lobby' ? null : '2026-07-20T10:00:00.000Z',
    endedAt: status === 'ended' ? '2026-07-20T10:30:00.000Z' : null,
    quizId: 'q1',
    quizTitle: `Partie ${i}`,
    playerCount: 3,
  }))
}

describe('Home', () => {
  beforeEach(() => vi.clearAllMocks())
  // No global cleanup is configured in this repo (see vitest.setup.ts) —
  // without this, each test's <Home> tree piles up in `document`, and the
  // filter tests' broad role queries (group/button by name) would match
  // stale nodes from earlier tests in this file.
  afterEach(cleanup)

  it('affiche le CTA primaire et les quiz en cartes', async () => {
    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    const cta = screen.getByRole('button', { name: /nouveau quiz/i })
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveAttribute('aria-expanded', 'false')

    await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
    const card = screen.getByText('Culture G').closest('.home-card')
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute('href', '/quizzes/q1')

    // The decorative signature glyph (Task 5) is aria-hidden — it must not
    // leak any text into the link's accessible name, which still starts
    // with the quiz title.
    expect(screen.getByRole('link', { name: /^Culture G/ })).toBe(card)
    const glyph = (card as Element).querySelector('.home-card__glyph')
    expect(glyph).not.toBeNull()
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
  })

  it("affiche un état vide chaleureux quand il n'y a pas de quiz", async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([])

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText(/on te fait de la place/i)).toBeInTheDocument())

    // The single 🐾 stays, and the decorative shape motif (Task 5) is
    // aria-hidden — it anchors the empty state visually without being
    // announced to screen readers.
    expect(screen.getByText(/on te fait de la place/i).textContent).toMatch(/🐾$/)
    const motif = document.querySelector('.home-empty-motif')
    expect(motif).not.toBeNull()
    expect(motif).toHaveAttribute('aria-hidden', 'true')
  })

  it('limite les parties récentes à 8 lignes avec un bouton « Voir toutes »', async () => {
    const { listSessions } = await import('../api/sessions')
    vi.mocked(listSessions).mockResolvedValueOnce(makeSessions())

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => {
      const items = document.querySelectorAll('.home-list__item')
      expect(items.length).toBe(8)
    })

    const showAllButton = screen.getByRole('button', { name: /voir toutes les parties \(12\)/i })
    expect(showAllButton).toBeInTheDocument()

    fireEvent.click(showAllButton)
    await waitFor(() => {
      const items = document.querySelectorAll('.home-list__item')
      expect(items.length).toBe(12)
    })
  })

  it('le filtre « Terminées » ne laisse que les sessions ended', async () => {
    const { listSessions } = await import('../api/sessions')
    vi.mocked(listSessions).mockResolvedValueOnce(makeSessions())

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() =>
      expect(document.querySelectorAll('.home-list__item').length).toBeGreaterThan(0),
    )

    const filterGroup = screen.getByRole('group', { name: /filtrer les parties par statut/i })
    const endedButton = within(filterGroup).getByRole('button', { name: 'Terminées' })
    expect(endedButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(endedButton)

    expect(endedButton).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      const items = document.querySelectorAll('.home-list__item')
      expect(items.length).toBe(5)
    })
    // Every remaining row shows the "Terminée" status badge.
    document.querySelectorAll('.home-list__item .host-badge').forEach((badge) => {
      expect(badge.textContent).toBe('Terminée')
    })
  })

  it('affiche la date de modification et la description sur les cartes de quiz', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([
      {
        id: 'q2',
        title: 'Quiz avec description',
        description: 'Ceci est une description',
        updatedAt: '2026-07-20T15:30:00Z',
        questionCount: 1,
      },
    ])

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Quiz avec description')).toBeInTheDocument())

    // Assert the description is shown
    expect(screen.getByText('Ceci est une description')).toBeInTheDocument()

    // Assert the meta line with the modified date is shown
    expect(screen.getByText(/Modifié le/)).toBeInTheDocument()
    expect(screen.getByText(/20 juil\. 2026/)).toBeInTheDocument()

    // Assert the question count is shown, singular for questionCount === 1
    expect(screen.getByText(/1 question(?!s)/)).toBeInTheDocument()

    // Assert the CTA says "Ouvrir"
    const card = screen.getByText('Quiz avec description').closest('.home-card')
    expect(within(card as Element).getByText('Ouvrir →')).toBeInTheDocument()
  })

  it('le bouton « Lancer » d\'une carte lance la partie sur la socket partagée et navigue vers /host/:id', async () => {
    mockEmitAck.mockResolvedValueOnce({ sessionId: 's1', pin: '123456' })

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
    const card = screen.getByText('Culture G').closest('.home-card-item') as Element
    const launchButton = within(card).getByRole('button', { name: /^Lancer$/ })

    // The button is a SIBLING of the card-link, not nested inside it — clicking it must not
    // trigger the link's own navigation to the editor.
    expect(card.querySelector('a')?.contains(launchButton)).toBe(false)

    fireEvent.click(launchButton)

    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:create', { quizId: 'q1' }))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/host/s1', {
        state: { pin: '123456', quizTitle: 'Culture G' },
      }),
    )
  })

  it('affiche le nombre de questions au pluriel sur les cartes', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([
      {
        id: 'q3',
        title: 'Quiz avec plusieurs questions',
        description: null,
        updatedAt: '2026-07-20T15:30:00Z',
        questionCount: 5,
      },
    ])

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Quiz avec plusieurs questions')).toBeInTheDocument())
    expect(screen.getByText(/5 questions/)).toBeInTheDocument()
  })

  it('affiche 0 question quand le quiz est vide', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([
      {
        id: 'q4',
        title: 'Quiz vide',
        description: null,
        updatedAt: '2026-07-20T15:30:00Z',
        questionCount: 0,
      },
    ])

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Quiz vide')).toBeInTheDocument())
    expect(screen.getByText(/0 question(?!s)/)).toBeInTheDocument()
  })
})
