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
const {
  mockUpdateQuestion,
  mockListQuestions,
  mockCreateQuestion,
  mockDeleteQuestion,
  mockReorderQuestions,
  baseQuestion,
} = vi.hoisted(() => ({
  mockUpdateQuestion: vi.fn(() => Promise.resolve({ id: 'quest1' })),
  mockListQuestions: vi.fn(),
  mockCreateQuestion: vi.fn(),
  mockDeleteQuestion: vi.fn(),
  mockReorderQuestions: vi.fn(),
  baseQuestion: {
    id: 'quest1',
    quizId: 'quiz1',
    type: 'mcq' as const,
    prompt: 'Une question',
    media: null,
    mediaAlt: null,
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
      createdAt: '2026-07-20T15:30:00Z',
      updatedAt: '2026-07-20T15:30:00Z',
    }),
  ),
  listQuestions: mockListQuestions,
  createQuestion: mockCreateQuestion,
  deleteQuestion: mockDeleteQuestion,
  reorderQuestions: mockReorderQuestions,
  updateQuestion: mockUpdateQuestion,
  updateQuiz: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn() }),
}))

const { mockUploadMedia } = vi.hoisted(() => ({ mockUploadMedia: vi.fn() }))
vi.mock('../api/media', () => ({ uploadMedia: mockUploadMedia }))
// Pas de canvas dans jsdom : le fichier est envoyé tel quel.
vi.mock('../media/downscale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media/downscale')>()),
  prepareImageForUpload: (file: File) => Promise.resolve({ blob: file, transformed: false }),
}))

vi.mock('../realtime/GameSocketProvider', () => ({
  useSharedGameSocket: () => ({ emitAck: vi.fn(), connected: true, socket: {}, on: vi.fn() }),
}))

import { HostEditor } from './HostEditor'

mockListQuestions.mockResolvedValue([baseQuestion])

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

describe('HostEditor — image de la question', () => {
  const withImage = { ...baseQuestion, media: '/uploads/t/a.png', mediaAlt: 'Un manchot' }
  beforeEach(() => {
    vi.clearAllMocks()
    mockListQuestions.mockResolvedValue([withImage])
  })
  afterEach(() => {
    cleanup()
    mockListQuestions.mockResolvedValue([baseQuestion])
  })

  it("retirer l'image envoie un PATCH avec media et mediaAlt à null", async () => {
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: "Retirer l'image" }))
    await waitFor(
      () =>
        expect(mockUpdateQuestion).toHaveBeenCalledWith(
          'quiz1',
          'quest1',
          expect.objectContaining({ media: null, mediaAlt: null }),
        ),
      { timeout: 2000 },
    )
  })

  it("changer le type d'une question conserve son image", async () => {
    mockCreateQuestion.mockResolvedValue({ ...withImage, id: 'quest2', type: 'truefalse', payload: { correct: true } })
    mockDeleteQuestion.mockResolvedValue(undefined)
    mockReorderQuestions.mockResolvedValue(undefined)
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Type de question'), { target: { value: 'truefalse' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Changer de type' }))
    await waitFor(() =>
      expect(mockCreateQuestion).toHaveBeenCalledWith(
        'quiz1',
        expect.objectContaining({ media: '/uploads/t/a.png', mediaAlt: 'Un manchot' }),
      ),
    )
  })

  it('annuler une suppression recrée la question avec son image', async () => {
    mockCreateQuestion.mockResolvedValue({ ...withImage, id: 'quest3' })
    mockDeleteQuestion.mockResolvedValue(undefined)
    mockReorderQuestions.mockResolvedValue(undefined)
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer la question' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
    await waitFor(() =>
      expect(mockCreateQuestion).toHaveBeenCalledWith(
        'quiz1',
        expect.objectContaining({ media: '/uploads/t/a.png', mediaAlt: 'Un manchot' }),
      ),
    )
  })
})

describe("HostEditor — envoi d'image et changement de question", () => {
  const second = { ...baseQuestion, id: 'quest2', prompt: 'Deuxième question', orderIndex: 1 }
  beforeEach(() => {
    vi.clearAllMocks()
    mockListQuestions.mockResolvedValue([baseQuestion, second])
  })
  afterEach(() => {
    cleanup()
    mockListQuestions.mockResolvedValue([baseQuestion])
  })

  it("un envoi terminé après être passé à une autre question est enregistré sur la question d'origine", async () => {
    let resolveUpload: (value: { url: string }) => void = () => {}
    mockUploadMedia.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve
      }),
    )
    renderEditor()
    fireEvent.change(await screen.findByTestId('question-image-file'), {
      target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(mockUploadMedia).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Deuxième question/ }))
    expect(await screen.findByDisplayValue('Deuxième question')).toBeInTheDocument()
    // Le champ image est propre à chaque question : pas d'« Envoi… » hérité de la première.
    expect(screen.getByRole('button', { name: 'Envoyer une image' })).toBeEnabled()

    resolveUpload({ url: '/uploads/t/nouvelle.png' })

    await waitFor(() =>
      expect(mockUpdateQuestion).toHaveBeenCalledWith(
        'quiz1',
        'quest1',
        expect.objectContaining({ media: '/uploads/t/nouvelle.png' }),
      ),
    )
    expect(mockUpdateQuestion).not.toHaveBeenCalledWith('quiz1', 'quest2', expect.anything())
  })
})
