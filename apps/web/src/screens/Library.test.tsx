// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryQuestion, LibraryQuizSummary } from '../api/library'

vi.mock('../api/library', () => ({
  getLibraryMeta: vi.fn(() =>
    Promise.resolve({
      themes: [{ id: 'histoire', label: 'Histoire' }],
      difficulties: ['facile', 'moyen', 'difficile'],
      audiences: ['enfants', 'adultes', 'tous'],
      languages: ['fr', 'en'],
    }),
  ),
  listLibraryQuizzes: vi.fn(),
  listLibraryQuestions: vi.fn(),
  drawLibraryQuestions: vi.fn(),
  duplicateLibraryQuiz: vi.fn(),
  composeQuiz: vi.fn(),
}))
vi.mock('../api/auth', () => ({ signOut: vi.fn(), useSession: () => ({ refresh: vi.fn() }) }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import * as lib from '../api/library'
import { SourceCredit } from '../ui/SourceCredit'
import { Library } from './Library'

const source = { name: 'Open Trivia', license: 'CC BY-SA 4.0', url: 'https://example.org' }

function quiz(id: string): LibraryQuizSummary {
  return {
    id,
    title: `Quiz ${id}`,
    description: null,
    theme: 'histoire',
    difficulty: 'facile',
    language: 'fr',
    audience: 'tous',
    source,
    questionCount: 3,
  }
}

function question(id: string): LibraryQuestion {
  return {
    id,
    type: 'mcq',
    prompt: `Énoncé ${id}`,
    payload: {},
    theme: 'histoire',
    difficulty: 'moyen',
    language: 'fr',
    audience: 'tous',
    timeLimit: 20,
    readingTime: 6,
    source,
  } as unknown as LibraryQuestion
}

function renderLibrary() {
  return render(
    <MemoryRouter>
      <Library />
    </MemoryRouter>,
  )
}

async function openQuestions() {
  renderLibrary()
  fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
  await waitFor(() => expect(screen.getByText('Énoncé a')).toBeInTheDocument())
}

describe('Library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(lib.listLibraryQuizzes).mockResolvedValue([quiz('q1')])
    vi.mocked(lib.listLibraryQuestions).mockResolvedValue({ items: [question('a'), question('b')], total: 2 })
  })
  afterEach(cleanup)

  it("affiche l'onglet quiz par défaut et « Dupliquer » ouvre le quiz renvoyé", async () => {
    vi.mocked(lib.duplicateLibraryQuiz).mockResolvedValue({ id: 'copie' } as never)
    renderLibrary()
    expect(screen.getByRole('tab', { name: 'Quiz tout prêts' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByText('Quiz q1')).toBeInTheDocument())
    expect(screen.getByText(/Source :/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dupliquer/ }))
    await waitFor(() => expect(lib.duplicateLibraryQuiz).toHaveBeenCalledWith('q1'))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/quizzes/copie'))
  })

  it('compose un quiz depuis deux questions cochées', async () => {
    vi.mocked(lib.composeQuiz).mockResolvedValue({ id: 'nouveau' } as never)
    await openQuestions()
    fireEvent.click(screen.getByRole('checkbox', { name: /Énoncé a/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Énoncé b/ }))
    expect(screen.getByRole('heading', { name: 'Ma sélection (2/100)' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Titre du quiz'), { target: { value: 'Mon quiz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Créer le quiz' }))
    await waitFor(() => expect(lib.composeQuiz).toHaveBeenCalledWith('Mon quiz', ['a', 'b']))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/quizzes/nouveau'))
  })

  it('désactive « Créer le quiz » quand la sélection est vide', async () => {
    await openQuestions()
    fireEvent.change(screen.getByLabelText('Titre du quiz'), { target: { value: 'Mon quiz' } })
    expect(screen.getByRole('button', { name: 'Créer le quiz' })).toBeDisabled()
  })

  it('plafonne la sélection à 100 : tirage borné, « Tirer » et « Créer le quiz » désactivés', async () => {
    const batch = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => question(`${prefix}${i}`))
    vi.mocked(lib.drawLibraryQuestions)
      .mockResolvedValueOnce(batch('d', 50))
      .mockResolvedValueOnce(batch('e', 48))
    await openQuestions()
    fireEvent.click(screen.getByRole('checkbox', { name: /Énoncé a/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Énoncé b/ }))
    const count = screen.getByLabelText('Tirer N questions au hasard')
    const draw = screen.getByRole('button', { name: 'Tirer' })
    fireEvent.change(count, { target: { value: '50' } })
    fireEvent.click(draw)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ma sélection (52/100)' })).toBeInTheDocument())
    // Le tirage suivant est ramené à la place restante (48).
    fireEvent.change(count, { target: { value: '50' } })
    fireEvent.click(draw)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ma sélection (100/100)' })).toBeInTheDocument())
    expect(vi.mocked(lib.drawLibraryQuestions).mock.calls[1][1]).toBe(48)
    expect(draw).toBeDisabled()
  })

  it('désactive « Créer le quiz » et « Tirer » au-dessus de 100 questions', async () => {
    const batch = (prefix: string) => Array.from({ length: 50 }, (_, i) => question(`${prefix}${i}`))
    vi.mocked(lib.drawLibraryQuestions).mockResolvedValueOnce(batch('d')).mockResolvedValueOnce(batch('e'))
    await openQuestions()
    const count = screen.getByLabelText('Tirer N questions au hasard')
    fireEvent.change(count, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tirer' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ma sélection (50/100)' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Tirer' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ma sélection (100/100)' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Titre du quiz'), { target: { value: 'Mon quiz' } })
    expect(screen.getByRole('button', { name: 'Créer le quiz' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Énoncé a/ }))
    expect(screen.getByRole('heading', { name: 'Ma sélection (101/100)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Créer le quiz' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Tirer' })).toBeDisabled()
  })

  it('limite le titre à 200 caractères et affiche les langues en français', async () => {
    await openQuestions()
    expect(screen.getByLabelText('Titre du quiz')).toHaveAttribute('maxLength', '200')
    const language = screen.getByLabelText('Langue')
    expect(within(language).getByRole('option', { name: 'français' })).toHaveValue('fr')
    expect(within(language).getByRole('option', { name: 'anglais' })).toHaveValue('en')
  })

  it("un tirage partiel affiche la disponibilité et n'ajoute pas de doublon", async () => {
    vi.mocked(lib.drawLibraryQuestions).mockResolvedValue([question('b'), question('c')])
    await openQuestions()
    fireEvent.click(screen.getByRole('checkbox', { name: /Énoncé b/ }))
    fireEvent.change(screen.getByLabelText('Tirer N questions au hasard'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tirer' }))
    await waitFor(() =>
      expect(screen.getByText('Seulement 2 questions disponibles avec ces filtres.')).toBeInTheDocument(),
    )
    expect(lib.drawLibraryQuestions).toHaveBeenCalledWith({}, 5, ['b'])
    expect(screen.getByRole('heading', { name: 'Ma sélection (2/100)' })).toBeInTheDocument()
  })

  it('un tirage vide affiche « Aucune question disponible »', async () => {
    vi.mocked(lib.drawLibraryQuestions).mockResolvedValue([])
    await openQuestions()
    fireEvent.click(screen.getByRole('button', { name: 'Tirer' }))
    await waitFor(() =>
      expect(screen.getByText('Aucune question disponible avec ces filtres.')).toBeInTheDocument(),
    )
  })

  it('relance listLibraryQuestions quand un filtre change', async () => {
    await openQuestions()
    fireEvent.change(screen.getByLabelText('Difficulté'), { target: { value: 'facile' } })
    await waitFor(() =>
      expect(lib.listLibraryQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ difficulty: 'facile' }),
        { offset: 0, limit: 20 },
      ),
    )
  })

  it('navigue entre onglets au clavier (ArrowRight, Home, End)', async () => {
    renderLibrary()
    const quizzesTab = screen.getByRole('tab', { name: 'Quiz tout prêts' })
    const questionsTab = screen.getByRole('tab', { name: 'Questions' })
    await waitFor(() => expect(screen.getByText('Quiz q1')).toBeInTheDocument())
    fireEvent.keyDown(quizzesTab, { key: 'ArrowRight' })
    expect(questionsTab).toHaveAttribute('aria-selected', 'true')
    expect(questionsTab).toHaveFocus()
    await waitFor(() => expect(screen.getByText('Énoncé a')).toBeInTheDocument())
    fireEvent.keyDown(questionsTab, { key: 'Home' })
    expect(quizzesTab).toHaveAttribute('aria-selected', 'true')
    expect(quizzesTab).toHaveFocus()
    fireEvent.keyDown(quizzesTab, { key: 'Home' })
    expect(quizzesTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(quizzesTab, { key: 'End' })
    expect(questionsTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(questionsTab, { key: 'End' })
    expect(questionsTab).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByText('Énoncé a')).toBeInTheDocument())
  })

  it('SourceCredit affiche nom et licence, rien sans source', () => {
    const { container, rerender } = render(<SourceCredit source={source} />)
    expect(container).toHaveTextContent('Source : Open Trivia, licence CC BY-SA 4.0 (adapté)')
    expect(within(container).getByRole('link', { name: 'Open Trivia' })).toHaveAttribute('href', 'https://example.org')
    expect(within(container).getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/deed.fr',
    )
    rerender(<SourceCredit source={{ name: 'Autre', license: 'Licence maison' }} />)
    expect(container).toHaveTextContent('Source : Autre, licence Licence maison (adapté)')
    expect(within(container).queryByRole('link')).toBeNull()
    rerender(<SourceCredit source={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
