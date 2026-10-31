// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
/**
 * Task 6 — focused coverage for the "Temps de lecture (s)" field: it must
 * read `readingTime` off the selected question and autosave it through the
 * SAME debounced PATCH flow as `timeLimit` (see `HostEditor.tsx`'s
 * autosave effect). Everything else about `HostEditor` (question list,
 * mcq/text/slider forms, launch flow, …) is exercised elsewhere/manually —
 * this file exists solely because no `HostEditor` test predates Task 6.
 */

// `vi.mock` factories are hoisted above ALL top-level statements (including
// `const` declarations) — anything they reference must come from
// `vi.hoisted` (not a plain top-level `const`), or the reference throws
// "Cannot access '...' before initialization" at collection time.
const { mockUpdateQuestion, baseQuestion, fixtures } = vi.hoisted(() => ({
  fixtures: { quizSource: null as unknown, questionSource: null as unknown, archivedAt: null as string | null },
  mockUpdateQuestion: vi.fn(() => Promise.resolve({ id: 'quest1' })),
  baseQuestion: {
    id: 'quest1',
    quizId: 'quiz1',
    type: 'mcq' as const,
    prompt: 'Une question',
    media: null,
    timeLimit: 20,
    readingTime: 5,
    orderIndex: 0,
    payload: {
      options: [
        { label: 'A', correct: true },
        { label: 'B', correct: false },
      ],
    },
    createdAt: '2026-07-20T15:30:00Z',
  },
}))

vi.mock('../api/quizzes', () => ({
  getQuiz: vi.fn(() =>
    Promise.resolve({
      id: 'quiz1',
      tenantId: 't1',
      ownerId: 'u1',
      title: 'Mon quiz',
      description: null,
      cover: null,
      source: fixtures.quizSource,
      createdAt: '2026-07-20T15:30:00Z',
      updatedAt: '2026-07-20T15:30:00Z',
      archivedAt: fixtures.archivedAt,
    }),
  ),
  listQuestions: vi.fn(() => Promise.resolve([{ ...baseQuestion, source: fixtures.questionSource }])),
  createQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  reorderQuestions: vi.fn(),
  updateQuestion: mockUpdateQuestion,
  updateQuiz: vi.fn(),
  archiveQuiz: vi.fn(),
  restoreQuiz: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn() }),
}))

vi.mock('../realtime/GameSocketProvider', () => ({
  useSharedGameSocket: () => ({ emitAck: vi.fn(), connected: true, socket: {}, on: vi.fn() }),
}))

import { HostEditor } from './HostEditor'

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/quizzes/quiz1']}>
      <Routes>
        <Route path="/quizzes/:quizId" element={<HostEditor />} />
        <Route path="/" element={<p>Page d'accueil</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HostEditor — champ Temps de lecture', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('affiche le temps de lecture de la question sélectionnée, avec l\'aide contextuelle', async () => {
    renderEditor()

    const input = (await screen.findByLabelText('Temps de lecture (s)')) as HTMLInputElement
    expect(input).toHaveValue(5)
    expect(input).toHaveAttribute('min', '0')
    expect(screen.getByText('0 = pas de temps de lecture')).toBeInTheDocument()
  })

  it('saisir une nouvelle valeur déclenche le patch autosave avec readingTime', async () => {
    renderEditor()

    const input = (await screen.findByLabelText('Temps de lecture (s)')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '10' } })

    await waitFor(
      () => {
        expect(mockUpdateQuestion).toHaveBeenCalledWith(
          'quiz1',
          'quest1',
          expect.objectContaining({ readingTime: 10 }),
        )
      },
      { timeout: 2000 },
    )
  })
})

describe('HostEditor : attribution des sources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixtures.quizSource = null
    fixtures.questionSource = null
  })
  afterEach(cleanup)

  it("regroupe les sources dans l'encadré « Sources et licences », avec la licence liée", async () => {
    fixtures.quizSource = { name: 'Open Trivia', license: 'CC BY-SA 4.0' }
    fixtures.questionSource = { name: 'Open Trivia', license: 'CC BY-SA 4.0', url: 'https://example.org/q' }
    renderEditor()
    const panel = await screen.findByRole('region', { name: 'Sources et licences' })
    expect(panel).toHaveTextContent('Toutes les questions : Open Trivia.')
    expect(within(panel).getByRole('link', { name: 'Open Trivia' })).toHaveAttribute('href', 'https://example.org/q')
    expect(within(panel).getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/deed.fr',
    )
    expect(panel).toHaveTextContent('Vos modifications de ces contenus restent sous cette licence.')
  })

  it("n'affiche aucun encadré de sources sans attribution", async () => {
    renderEditor()
    await screen.findByLabelText('Temps de lecture (s)')
    expect(screen.queryByRole('region', { name: 'Sources et licences' })).toBeNull()
  })
})

describe('HostEditor : archivage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixtures.quizSource = null
    fixtures.questionSource = null
    fixtures.archivedAt = null
  })
  afterEach(cleanup)

  it('« Archiver ce quiz » demande confirmation, archive puis revient à l\'accueil', async () => {
    const { archiveQuiz } = await import('../api/quizzes')
    vi.mocked(archiveQuiz).mockResolvedValueOnce({} as never)
    renderEditor()

    const trigger = await screen.findByRole('button', { name: 'Archiver ce quiz' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Archiver ce quiz ?' })
    // L'éditeur passe en arrière-plan inerte pour les technologies d'assistance.
    expect(document.getElementById('contenu-principal')).toHaveAttribute('aria-hidden', 'true')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(archiveQuiz).not.toHaveBeenCalled()

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archiver' }))
    await screen.findByText("Page d'accueil")
    expect(archiveQuiz).toHaveBeenCalledWith('quiz1')
  })

  it('un quiz archivé affiche le bandeau « Restaurer », bloque le lancement, et redevient lançable une fois restauré', async () => {
    fixtures.archivedAt = '2026-08-01T10:00:00Z'
    const { restoreQuiz } = await import('../api/quizzes')
    vi.mocked(restoreQuiz).mockResolvedValueOnce({
      id: 'quiz1', tenantId: 't1', ownerId: 'u1', title: 'Mon quiz', description: null, cover: null,
      source: null, createdAt: '2026-07-20T15:30:00Z', updatedAt: '2026-07-20T15:30:00Z', archivedAt: null,
    })
    renderEditor()

    expect(await screen.findByText(/Ce quiz est archivé\./)).toBeInTheDocument()
    const launch = screen.getByRole('button', { name: 'Lancer la partie' })
    expect(launch).toHaveAttribute('aria-disabled', 'true')
    expect(launch).toHaveAccessibleDescription(/Ce quiz est archivé/)
    // Contenu toujours modifiable, mais pas de second « Archiver ».
    expect(screen.getByLabelText('Titre du quiz')).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Archiver ce quiz' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restaurer' }))
    await waitFor(() => expect(screen.queryByText(/Ce quiz est archivé\./)).toBeNull())
    expect(restoreQuiz).toHaveBeenCalledWith('quiz1')
    expect(screen.getByRole('button', { name: 'Lancer la partie' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: 'Archiver ce quiz' })).toBeInTheDocument()
  })
})
