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
  archiveQuiz: vi.fn(),
  restoreQuiz: vi.fn(),
}))
vi.mock('../api/sessions', () => ({ listSessions: vi.fn(() => Promise.resolve([])) }))
const mockSendVerificationEmail = vi.fn()
vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn(), user: { email: 'camille@example.com', emailVerified: false } }),
  sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
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
 * limit and the En cours / Historique split without depending on real API
 * data. */
function makeSessions(): SessionSummary[] {
  const statuses: SessionStatus[] = [
    'ended',
    'ended',
    'ended',
    'ended',
    'ended',
    'active',
    'active',
    'active',
    'lobby',
    'lobby',
    'lobby',
    'lobby',
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

/** 12 terminal ("ended") sessions — `Home` (Task 9) resolves `listSessions()`
 * for « En cours » and « Historique » via two separate calls, so a test
 * exercising the Historique pagination must feed the SECOND `listSessions`
 * call, not a single combined list. */
function makeHistorySessions(): SessionSummary[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `h${i}`,
    pin: String(200000 + i),
    status: 'ended' as const,
    startedAt: '2026-07-20T10:00:00.000Z',
    endedAt: '2026-07-20T10:30:00.000Z',
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

  it("refus de création faute d'adresse confirmée : message dédié et renvoi sur place", async () => {
    const { createQuiz } = await import('../api/quizzes')
    const { ApiError } = await import('../api/client')
    vi.mocked(createQuiz).mockRejectedValueOnce(
      new ApiError(403, "Confirmez votre adresse e-mail pour créer d'autres quiz.", 'email_unverified_quiz_limit'),
    )
    mockSendVerificationEmail.mockResolvedValue(undefined)
    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /nouveau quiz/i }))
    fireEvent.change(screen.getByLabelText('Titre du nouveau quiz'), { target: { value: 'Second' } })
    fireEvent.submit(screen.getByLabelText('Titre du nouveau quiz').closest('form') as HTMLFormElement)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Confirmez votre adresse e-mail pour créer d'autres quiz.")
    fireEvent.click(within(alert).getByRole('button', { name: "Renvoyer l'e-mail" }))
    await waitFor(() => expect(screen.getByText('E-mail envoyé')).toBeInTheDocument())
    expect(mockSendVerificationEmail).toHaveBeenCalledWith('camille@example.com')
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

    await waitFor(() => expect(screen.getByText(/on vous fait de la place/i)).toBeInTheDocument())

    // Le motif décoratif de formes est aria-hidden : il ancre visuellement
    // l'état vide sans être annoncé aux lecteurs d'écran.
    const motif = document.querySelector('.home-empty-motif')
    expect(motif).not.toBeNull()
    expect(motif).toHaveAttribute('aria-hidden', 'true')
  })

  it("limite l'historique à 8 lignes avec un bouton « Voir tout l'historique »", async () => {
    const { listSessions } = await import('../api/sessions')
    // Home (Task 9) issues two independent listSessions() calls in this
    // order: En cours (lobby/active) first, Historique (ended/abandoned)
    // second — see loadSessions's Promise.all.
    vi.mocked(listSessions).mockResolvedValueOnce([]).mockResolvedValueOnce(makeHistorySessions())

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

    const showAllButton = screen.getByRole('button', { name: /voir tout l'historique \(12\)/i })
    expect(showAllButton).toBeInTheDocument()

    fireEvent.click(showAllButton)
    await waitFor(() => {
      const items = document.querySelectorAll('.home-list__item')
      expect(items.length).toBe(12)
    })
  })

  it('sépare les parties en deux sections « En cours » (lobby/active) et « Historique » (ended/abandoned), avec le badge « Abandonnée »', async () => {
    const { listSessions } = await import('../api/sessions')
    vi.mocked(listSessions)
      .mockResolvedValueOnce([
        {
          id: 'live-1',
          pin: '111111',
          status: 'active',
          startedAt: '2026-07-20T10:00:00.000Z',
          endedAt: null,
          quizId: 'q1',
          quizTitle: 'Partie en cours',
          playerCount: 2,
        },
        {
          id: 'lobby-1',
          pin: '222222',
          status: 'lobby',
          startedAt: null,
          endedAt: null,
          quizId: 'q1',
          quizTitle: 'Partie en attente',
          playerCount: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ended-1',
          pin: '333333',
          status: 'ended',
          startedAt: '2026-07-20T10:00:00.000Z',
          endedAt: '2026-07-20T10:30:00.000Z',
          quizId: 'q1',
          quizTitle: 'Partie terminée',
          playerCount: 4,
        },
        {
          id: 'abandoned-1',
          pin: '444444',
          status: 'abandoned',
          startedAt: '2026-07-20T10:00:00.000Z',
          endedAt: '2026-07-20T10:20:00.000Z',
          quizId: 'q1',
          quizTitle: 'Partie abandonnée',
          playerCount: 1,
        },
      ])

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Partie en cours')).toBeInTheDocument())

    // The two independent calls carry the right server-side status filters.
    expect(listSessions).toHaveBeenNthCalledWith(1, { status: ['lobby', 'active'] })
    expect(listSessions).toHaveBeenNthCalledWith(2, { status: ['ended', 'abandoned'] })

    const liveSection = document.getElementById('home-live-heading')?.closest('section') as HTMLElement
    expect(within(liveSection).getByText('Partie en cours')).toBeInTheDocument()
    expect(within(liveSection).getByText('Partie en attente')).toBeInTheDocument()
    expect(within(liveSection).queryByText('Partie terminée')).toBeNull()
    expect(within(liveSection).queryByText('Partie abandonnée')).toBeNull()

    const historySection = document.getElementById('home-history-heading')?.closest('section') as HTMLElement
    expect(within(historySection).getByText('Partie terminée')).toBeInTheDocument()
    expect(within(historySection).getByText('Partie abandonnée')).toBeInTheDocument()

    // The « Abandonnée » badge carries a distinct class (dashed border, see
    // prototype.css) on top of the required visible-text label — status is
    // never conveyed by colour alone.
    const abandonedBadge = within(historySection).getByText('Abandonnée')
    expect(abandonedBadge).toHaveClass('host-badge', 'host-badge--abandoned')

    // abandoned is terminal, exactly like ended: routes to the report, not
    // back to the live host controller, with the matching CTA copy.
    const abandonedLink = screen.getByText('Partie abandonnée').closest('a')
    expect(abandonedLink).toHaveAttribute('href', '/sessions/abandoned-1')
    expect(within(abandonedLink as HTMLElement).getByText('Voir le rapport →')).toBeInTheDocument()
  })

  it('affiche la date de modification et la description sur les cartes de quiz', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([
      {
        id: 'q2',
        tenantId: 't1',
        ownerId: 'u1',
        title: 'Quiz avec description',
        description: 'Ceci est une description',
        cover: null,
        source: null,
        createdAt: '2026-07-20T15:30:00Z',
        updatedAt: '2026-07-20T15:30:00Z',
        archivedAt: null,
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
    expect(within(card as HTMLElement).getByText('Ouvrir →')).toBeInTheDocument()
  })

  it("le bouton « Lancer » d'une carte lance la partie sur la socket partagée et navigue vers /host/:id", async () => {
    mockEmitAck.mockResolvedValueOnce({ sessionId: 's1', pin: '123456' })

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
    const card = screen.getByText('Culture G').closest('.home-card-item') as HTMLElement
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

  it('les parties "lobby"/"active" mènent vers /host/:id (Reprendre) ; "ended" vers /sessions/:id (rapport)', async () => {
    const { listSessions } = await import('../api/sessions')
    vi.mocked(listSessions)
      .mockResolvedValueOnce([
        {
          id: 'live-1',
          pin: '111111',
          status: 'active',
          startedAt: '2026-07-20T10:00:00.000Z',
          endedAt: null,
          quizId: 'q1',
          quizTitle: 'Partie en cours',
          playerCount: 2,
        },
        {
          id: 'lobby-1',
          pin: '222222',
          status: 'lobby',
          startedAt: null,
          endedAt: null,
          quizId: 'q1',
          quizTitle: 'Partie en attente',
          playerCount: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ended-1',
          pin: '333333',
          status: 'ended',
          startedAt: '2026-07-20T10:00:00.000Z',
          endedAt: '2026-07-20T10:30:00.000Z',
          quizId: 'q1',
          quizTitle: 'Partie terminée',
          playerCount: 4,
        },
      ])

    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Partie en cours')).toBeInTheDocument())

    const activeLink = screen.getByText('Partie en cours').closest('a')
    expect(activeLink).toHaveAttribute('href', '/host/live-1')
    expect(within(activeLink as HTMLElement).getByText('Reprendre →')).toBeInTheDocument()

    const lobbyLink = screen.getByText('Partie en attente').closest('a')
    expect(lobbyLink).toHaveAttribute('href', '/host/lobby-1')
    expect(within(lobbyLink as HTMLElement).getByText('Reprendre →')).toBeInTheDocument()

    const endedLink = screen.getByText('Partie terminée').closest('a')
    expect(endedLink).toHaveAttribute('href', '/sessions/ended-1')
    expect(within(endedLink as HTMLElement).getByText('Voir le rapport →')).toBeInTheDocument()
  })

  it('affiche le nombre de questions au pluriel sur les cartes', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([
      {
        id: 'q3',
        tenantId: 't1',
        ownerId: 'u1',
        title: 'Quiz avec plusieurs questions',
        description: null,
        cover: null,
        source: null,
        createdAt: '2026-07-20T15:30:00Z',
        updatedAt: '2026-07-20T15:30:00Z',
        archivedAt: null,
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

  it('propose un lien « Bibliothèque » vers /library', async () => {
    render(
      <MotionProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </MotionProvider>,
    )
    expect(screen.getByRole('link', { name: 'Bibliothèque' })).toHaveAttribute('href', '/library')
    await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
  })

  it('affiche 0 question quand le quiz est vide', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([
      {
        id: 'q4',
        tenantId: 't1',
        ownerId: 'u1',
        title: 'Quiz vide',
        description: null,
        cover: null,
        source: null,
        createdAt: '2026-07-20T15:30:00Z',
        updatedAt: '2026-07-20T15:30:00Z',
        archivedAt: null,
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

  describe('archivage', () => {
    const archivedQuiz = {
      id: 'qa',
      tenantId: 't1',
      ownerId: 'u1',
      title: 'Vieux quiz',
      description: null,
      cover: null,
      source: null,
      createdAt: '2026-07-20T15:30:00Z',
      updatedAt: '2026-07-20T15:30:00Z',
      archivedAt: '2026-08-01T10:00:00Z',
      questionCount: 3,
    }

    function renderHome() {
      render(
        <MotionProvider>
          <MemoryRouter>
            <Home />
          </MemoryRouter>
        </MotionProvider>,
      )
    }

    it("« Archiver » ouvre une confirmation ; Annuler ne fait rien, confirmer retire la carte et l'annonce", async () => {
      const { archiveQuiz } = await import('../api/quizzes')
      vi.mocked(archiveQuiz).mockResolvedValueOnce({ ...archivedQuiz, id: 'q1', title: 'Culture G' })
      renderHome()

      await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
      const card = screen.getByText('Culture G').closest('.home-card-item') as HTMLElement
      const archiveButton = within(card).getByRole('button', { name: 'Archiver le quiz Culture G' })

      // Annuler (et Échap) referment sans appel réseau, le focus revient au bouton
      // (focus explicite : `fireEvent.click` ne le déplace pas comme un vrai clic).
      archiveButton.focus()
      fireEvent.click(archiveButton)
      let dialog = screen.getByRole('dialog', { name: 'Archiver ce quiz ?' })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(archiveButton).toHaveFocus()
      fireEvent.click(archiveButton)
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(archiveQuiz).not.toHaveBeenCalled()

      fireEvent.click(archiveButton)
      dialog = screen.getByRole('dialog', { name: 'Archiver ce quiz ?' })
      expect(within(dialog).getByRole('button', { name: 'Archiver' })).toHaveFocus()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Archiver' }))

      await waitFor(() => expect(screen.queryByText('Culture G')).toBeNull())
      expect(archiveQuiz).toHaveBeenCalledWith('q1')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByText('Quiz « Culture G » archivé.')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Mes quiz' })).toHaveFocus()
    })

    it("la section « Archivés » charge les quiz archivés à l'ouverture et « Restaurer » les remet dans « Mes quiz »", async () => {
      const { listQuizzes, restoreQuiz } = await import('../api/quizzes')
      vi.mocked(restoreQuiz).mockResolvedValueOnce({ ...archivedQuiz, archivedAt: null })
      renderHome()

      await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
      // Rien n'est chargé tant que la section reste repliée.
      expect(listQuizzes).toHaveBeenCalledTimes(1)
      expect(listQuizzes).not.toHaveBeenCalledWith({ archived: true })

      vi.mocked(listQuizzes).mockResolvedValueOnce([archivedQuiz])
      const summary = screen.getByText('Archivés')
      const details = summary.closest('details') as HTMLDetailsElement
      details.open = true
      fireEvent(details, new Event('toggle'))

      await waitFor(() => expect(screen.getByText('Vieux quiz')).toBeInTheDocument())
      expect(listQuizzes).toHaveBeenCalledWith({ archived: true })
      expect(screen.getByText(/Archivé le 1 août 2026/)).toBeInTheDocument()
      // Pas de « Lancer » pour un quiz archivé.
      const row = screen.getByText('Vieux quiz').closest('li') as HTMLElement
      expect(within(row).queryByRole('button', { name: /^Lancer$/ })).toBeNull()

      fireEvent.click(within(row).getByRole('button', { name: 'Restaurer le quiz Vieux quiz' }))

      await waitFor(() => expect(restoreQuiz).toHaveBeenCalledWith('qa'))
      await waitFor(() => expect(screen.getByText('Vieux quiz').closest('.home-card-item')).not.toBeNull())
      expect(screen.getByText('Aucun quiz archivé.')).toBeInTheDocument()
      expect(screen.getByText('Quiz « Vieux quiz » restauré.')).toBeInTheDocument()
    })

    it("« Restaurer » refusé faute d'adresse confirmée : message dédié et renvoi sur place", async () => {
      const { listQuizzes, restoreQuiz } = await import('../api/quizzes')
      const { ApiError } = await import('../api/client')
      vi.mocked(restoreQuiz).mockRejectedValueOnce(
        new ApiError(403, "Confirmez votre adresse e-mail pour créer d'autres quiz.", 'email_unverified_quiz_limit'),
      )
      mockSendVerificationEmail.mockResolvedValue(undefined)
      renderHome()
      await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
      vi.mocked(listQuizzes).mockResolvedValueOnce([archivedQuiz])
      const details = screen.getByText('Archivés').closest('details') as HTMLDetailsElement
      details.open = true
      fireEvent(details, new Event('toggle'))
      await waitFor(() => expect(screen.getByText('Vieux quiz')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Restaurer le quiz Vieux quiz' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("Confirmez votre adresse e-mail pour créer d'autres quiz.")
      fireEvent.click(within(alert).getByRole('button', { name: "Renvoyer l'e-mail" }))
      await waitFor(() => expect(screen.getByText('E-mail envoyé')).toBeInTheDocument())
    })
  })
})
