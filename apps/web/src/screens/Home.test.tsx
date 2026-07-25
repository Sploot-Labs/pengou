// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MotionProvider } from '../motion/index.js'

vi.mock('../api/quizzes', () => ({
  listQuizzes: vi.fn(() =>
    Promise.resolve([{ id: 'q1', title: 'Culture G', description: null }]),
  ),
  createQuiz: vi.fn(),
}))
vi.mock('../api/sessions', () => ({ listSessions: vi.fn(() => Promise.resolve([])) }))
vi.mock('../api/auth', () => ({
  signOut: vi.fn(),
  useSession: () => ({ refresh: vi.fn() }),
}))

import { Home } from './Home'

describe('Home', () => {
  beforeEach(() => vi.clearAllMocks())

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
  })
})
