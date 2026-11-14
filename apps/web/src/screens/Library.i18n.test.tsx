// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as lib from '../api/library'
import { setLang } from '../i18n/lang'
import { Library } from './Library'

vi.mock('../api/library', () => ({
  getLibraryMeta: vi.fn(),
  listLibraryQuizzes: vi.fn(),
  listLibraryQuestions: vi.fn(),
  drawLibraryQuestions: vi.fn(),
  duplicateLibraryQuiz: vi.fn(),
  composeQuiz: vi.fn(),
  getLibraryQuiz: vi.fn(),
}))
vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn(), user: { email: 'camille@example.com', emailVerified: true } }),
  sendVerificationEmail: vi.fn(),
}))
vi.mock('../realtime/useLaunchGame', () => ({
  useLaunchGame: () => ({ launch: vi.fn(), launching: false, error: null }),
}))

// Sans `globals`, React Testing Library ne démonte pas seul : un écran resté monté en en/es se
// réaffiche hors act quand la langue est remise à zéro.
afterEach(cleanup)

function meta(languages: string[]) {
  return {
    themes: [{ id: 'histoire', label: 'Histoire' }],
    difficulties: ['facile', 'moyen', 'difficile'],
    audiences: ['enfants', 'adultes', 'tous'],
    languages,
  } as never
}

function quizRow(id: string) {
  return {
    id,
    title: `Quiz ${id}`,
    description: null,
    theme: 'histoire',
    difficulty: 'facile' as const,
    language: 'fr',
    audience: 'tous' as const,
    source: { name: 'Open Trivia', license: 'CC BY-SA 4.0', url: 'https://example.org' },
    questionCount: 3,
  }
}

function renderLibrary() {
  return render(
    <MemoryRouter>
      <Library />
    </MemoryRouter>,
  )
}

describe('Library traduite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(lib.listLibraryQuizzes).mockResolvedValue([])
  })

  it("présélectionne la langue de l'interface quand le catalogue la propose", async () => {
    vi.mocked(lib.getLibraryMeta).mockResolvedValue(meta(['fr', 'en']))
    act(() => setLang('en'))
    renderLibrary()
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ready-made quizzes' })).toBeInTheDocument()
    const language = screen.getByLabelText('Language') as HTMLSelectElement
    await waitFor(() => expect(language.value).toBe('en'))
    expect(within(language).getByRole('option', { name: 'English' })).toHaveValue('en')
    expect(within(language).getByRole('option', { name: 'French' })).toHaveValue('fr')
    await waitFor(() => expect(lib.listLibraryQuizzes).toHaveBeenCalledWith({ language: 'en' }))
  })

  it('retombe sur « All » quand le catalogue ne propose pas la langue', async () => {
    vi.mocked(lib.getLibraryMeta).mockResolvedValue(meta(['fr']))
    act(() => setLang('en'))
    renderLibrary()
    const language = screen.getByLabelText('Language') as HTMLSelectElement
    await waitFor(() => expect(within(language).getByRole('option', { name: 'French' })).toBeInTheDocument())
    expect(language.value).toBe('')
    expect(within(language).getByRole('option', { name: 'All' })).toHaveValue('')
    expect(lib.listLibraryQuizzes).toHaveBeenCalledWith({})
  })

  it('affiche les libellés en espagnol', async () => {
    vi.mocked(lib.getLibraryMeta).mockResolvedValue(meta(['fr', 'es']))
    act(() => setLang('es'))
    renderLibrary()
    expect(screen.getByRole('heading', { name: 'Biblioteca' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Quiz ya preparados' })).toBeInTheDocument()
    const language = screen.getByLabelText('Idioma') as HTMLSelectElement
    await waitFor(() => expect(language.value).toBe('es'))
    expect(within(language).getByRole('option', { name: 'español' })).toHaveValue('es')
  })

  it("traduit les thèmes intégrés ; un thème ajouté par l'instance garde son libellé enregistré", async () => {
    vi.mocked(lib.getLibraryMeta).mockResolvedValue({
      themes: [
        { id: 'histoire', label: 'Histoire' },
        { id: 'astronomie-locale', label: 'Astronomie locale' },
      ],
      difficulties: ['facile'],
      audiences: ['tous'],
      languages: ['fr', 'en'],
    } as never)
    vi.mocked(lib.listLibraryQuizzes).mockResolvedValue([
      { ...quizRow('q1'), theme: 'histoire' },
      { ...quizRow('q2'), theme: 'astronomie-locale' },
    ])
    act(() => setLang('en'))
    renderLibrary()
    const themeSelect = screen.getByLabelText('Theme') as HTMLSelectElement
    await waitFor(() => expect(within(themeSelect).getByRole('option', { name: 'History' })).toHaveValue('histoire'))
    expect(within(themeSelect).getByRole('option', { name: 'Astronomie locale' })).toHaveValue('astronomie-locale')
    expect(await screen.findByText('3 questions, Easy, History')).toBeInTheDocument()
    expect(screen.getByText('3 questions, Easy, Astronomie locale')).toBeInTheDocument()
  })

  it("demande quand même les listes sans filtre et affiche l'erreur si le catalogue échoue", async () => {
    vi.mocked(lib.getLibraryMeta).mockRejectedValue(new Error('boom'))
    act(() => setLang('en'))
    renderLibrary()
    await waitFor(() => expect(lib.listLibraryQuizzes).toHaveBeenCalledWith({}))
    expect(await screen.findByText('A network error occurred. Try again.')).toBeInTheDocument()
  })
})
