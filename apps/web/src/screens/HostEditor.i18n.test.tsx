// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
import { HostEditor } from './HostEditor'

const { question } = vi.hoisted(() => ({
  question: {
    id: 'quest1',
    quizId: 'quiz1',
    type: 'mcq' as const,
    prompt: '',
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
    source: null,
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
      source: null,
      createdAt: '2026-07-20T15:30:00Z',
      updatedAt: '2026-07-20T15:30:00Z',
      archivedAt: null,
    }),
  ),
  listQuestions: vi.fn(() => Promise.resolve([question])),
  createQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  reorderQuestions: vi.fn(),
  updateQuestion: vi.fn(() => Promise.resolve({ id: 'quest1' })),
  updateQuiz: vi.fn(),
  archiveQuiz: vi.fn(),
  restoreQuiz: vi.fn(),
}))
vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn(), user: { email: 'camille@example.com', emailVerified: true } }),
  sendVerificationEmail: vi.fn(),
}))
vi.mock('../api/media', () => ({ uploadMedia: vi.fn() }))
vi.mock('../realtime/useLaunchGame', () => ({
  useLaunchGame: () => ({ launch: vi.fn(), launching: false, error: null }),
}))

// Sans `globals`, React Testing Library ne démonte pas seul : un écran resté monté en en/es se
// réaffiche hors act quand la langue est remise à zéro.
afterEach(cleanup)

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/quizzes/quiz1']}>
      <Routes>
        <Route path="/quizzes/:quizId" element={<HostEditor />} />
      </Routes>
    </MemoryRouter>,
  )
}

function typeOptions(select: HTMLElement) {
  return within(select)
    .getAllByRole('option')
    .map((o) => o.textContent)
}

describe('HostEditor traduit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('affiche les types de question en anglais', async () => {
    act(() => setLang('en'))
    renderEditor()
    expect(await screen.findByRole('heading', { name: 'Quiz editor' })).toBeInTheDocument()
    expect(typeOptions(screen.getByLabelText('Question type'))).toEqual([
      'Multiple choice (4 answers)',
      'True / False',
      'Free text',
      'Slider',
      'Word cloud',
      'Poll',
    ])
    // Le prompt vide donne une erreur de validation, traduite dans la liste et le formulaire.
    expect(screen.getByText('To fix: Question text missing.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the game' })).toBeInTheDocument()
  })

  it('affiche les types de question en espagnol', async () => {
    act(() => setLang('es'))
    renderEditor()
    expect(await screen.findByRole('heading', { name: 'Editor de quiz' })).toBeInTheDocument()
    expect(typeOptions(screen.getByLabelText('Tipo de pregunta'))).toEqual([
      'Opción múltiple (4)',
      'Verdadero / Falso',
      'Respuesta libre',
      'Deslizador',
      'Nube de palabras',
      'Encuesta',
    ])
    expect(screen.getByText('Por corregir: Falta el enunciado.')).toBeInTheDocument()
  })

  it('se retraduit au changement de langue, formes de réponse comprises', async () => {
    renderEditor()
    expect(await screen.findByRole('heading', { name: 'Éditeur de quiz' })).toBeInTheDocument()
    expect(screen.getByLabelText('Libellé réponse 1, étoile')).toBeInTheDocument()
    act(() => setLang('en'))
    expect(screen.getByRole('heading', { name: 'Quiz editor' })).toBeInTheDocument()
    expect(screen.getByLabelText('Answer 1 label, star')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Question text'), { target: { value: 'Une question' } })
    expect(screen.queryByText(/To fix/)).not.toBeInTheDocument()
  })
})
