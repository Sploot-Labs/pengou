// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  fixtures: { quizSource: null as unknown, questionSource: null as unknown },
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
    }),
  ),
  listQuestions: vi.fn(() => Promise.resolve([{ ...baseQuestion, source: fixtures.questionSource }])),
  createQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  reorderQuestions: vi.fn(),
  updateQuestion: mockUpdateQuestion,
  updateQuiz: vi.fn(),
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

  it('affiche la source du quiz sous le titre', async () => {
    fixtures.quizSource = { name: 'Open Trivia', license: 'CC BY-SA 4.0' }
    renderEditor()
    await screen.findByLabelText('Titre du quiz')
    expect(document.body).toHaveTextContent('Source : Open Trivia, licence CC BY-SA 4.0 (adapté)')
  })

  it("affiche la source d'une question dans sa carte", async () => {
    fixtures.questionSource = { name: 'Wikiquiz', license: 'CC0', url: 'https://example.org/q' }
    renderEditor()
    const link = await screen.findByRole('link', { name: 'Wikiquiz' })
    expect(link).toHaveAttribute('href', 'https://example.org/q')
    expect(screen.getByText(/licence CC0 \(adapté\)/)).toBeInTheDocument()
  })

  it("n'affiche aucune mention de source sans attribution", async () => {
    renderEditor()
    await screen.findByLabelText('Temps de lecture (s)')
    expect(screen.queryByText(/Source :/)).toBeNull()
  })
})
