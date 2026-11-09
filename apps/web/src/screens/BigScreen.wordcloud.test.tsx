// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { BigScreen } from './BigScreen.js'

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()
const mockEmitAck = vi.fn(async () => ({}))

function emitServerEvent(event: string, payload: unknown) {
  act(() => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  })
}

vi.mock('../realtime/useGameSocket', () => ({
  useGameSocket: () => ({
    socket: { connected: true },
    connected: true,
    emitAck: mockEmitAck,
    on: (event: string, callback: Handler) => {
      const list = handlers.get(event) ?? []
      list.push(callback)
      handlers.set(event, list)
      return () => {
        const idx = list.indexOf(callback)
        if (idx >= 0) list.splice(idx, 1)
      }
    },
  }),
}))

function renderBigScreen() {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={['/screen/s1?token=tok-abc&pin=1234']}>
        <Routes>
          <Route path="/screen/:sessionId" element={<BigScreen />} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  )
}

const cloudQuestion = { id: 'q1', type: 'wordcloud', prompt: 'Un mot sur le café ?', timeLimit: 30, payload: {} }

function view(over: Record<string, unknown> = {}) {
  return {
    questionId: 'q1',
    words: [
      { key: 'cafe', text: 'café', count: 3 },
      { key: 'the', text: 'thé', count: 1 },
    ],
    participants: 3,
    totalWords: 4,
    truncated: false,
    ...over,
  }
}

describe('BigScreen, nuage de mots en direct', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  afterEach(cleanup)

  async function joined() {
    renderBigScreen()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))
  }

  async function showQuestion(q: { prompt: string; [k: string]: unknown }) {
    emitServerEvent('question:show', q)
    await screen.findByText(q.prompt)
  }

  it("affiche les mots et les compteurs d'un wordcloud:update", async () => {
    await joined()
    await showQuestion(cloudQuestion)
    emitServerEvent('wordcloud:update', view())
    expect(screen.getByText('café')).toBeInTheDocument()
    expect(screen.getByText('thé')).toBeInTheDocument()
    expect(screen.getByText('3 participants ont proposé, 4 mots reçus')).toBeInTheDocument()
  })

  it('ajoute la mention des 100 mots les plus cités quand le nuage est tronqué', async () => {
    await joined()
    await showQuestion(cloudQuestion)
    emitServerEvent('wordcloud:update', view({ truncated: true }))
    expect(screen.getByText(/\(100 mots les plus cités\)/)).toBeInTheDocument()
  })

  it('accorde au singulier', async () => {
    await joined()
    await showQuestion(cloudQuestion)
    emitServerEvent(
      'wordcloud:update',
      view({ participants: 1, totalWords: 1, words: [{ key: 'a', text: 'a', count: 1 }] }),
    )
    expect(screen.getByText('1 participant a proposé, 1 mot reçu')).toBeInTheDocument()
  })

  it("affiche l'état vide avant le premier mot", async () => {
    await joined()
    await showQuestion(cloudQuestion)
    expect(screen.getByText('En attente des premières idées…')).toBeInTheDocument()
  })

  it("n'affiche pas la ligne « x / y ont répondu » pour un nuage", async () => {
    await joined()
    await showQuestion(cloudQuestion)
    emitServerEvent('wordcloud:update', view())
    expect(screen.queryByText(/répondu/)).toBeNull()
  })

  it("un nouveau question:show d'une autre question efface l'ancien nuage", async () => {
    await joined()
    await showQuestion(cloudQuestion)
    emitServerEvent('wordcloud:update', view())
    emitServerEvent('question:show', { ...cloudQuestion, id: 'q2' })
    // Deux questions nuage successives ont des clés de transition distinctes : l'ancienne couche
    // sort en fondu avant que la nouvelle n'entre.
    await waitFor(() => expect(screen.queryByText('café')).toBeNull())
    expect(await screen.findByText('En attente des premières idées…')).toBeInTheDocument()
  })

  it('garde le nuage à la révélation, sans tableau de répartition', async () => {
    await joined()
    await showQuestion(cloudQuestion)
    emitServerEvent('wordcloud:update', view())
    emitServerEvent('question:reveal', { correct: null, distribution: {} })
    expect(screen.getByText('café')).toBeInTheDocument()
    expect(screen.getByText('3 participants ont proposé, 4 mots reçus')).toBeInTheDocument()
    expect(screen.queryByText('Aucune réponse reçue pour cette question.')).toBeNull()
  })

  it('garde le même nœud de nuage de la question à la révélation (pas de remontage)', async () => {
    const { container } = renderBigScreen()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))
    await showQuestion(cloudQuestion)
    emitServerEvent('wordcloud:update', view())
    const before = container.querySelector('.bigcloud')
    expect(before).not.toBeNull()
    emitServerEvent('question:reveal', { correct: null, distribution: {} })
    await waitFor(() => expect(container.querySelector('.bigcloud--revealed')).not.toBeNull())
    expect(container.querySelector('.bigcloud')).toBe(before)
  })

  it('une question mcq garde le rendu actuel', async () => {
    await joined()
    await showQuestion({
      id: 'q3',
      type: 'mcq',
      prompt: 'Capitale ?',
      timeLimit: 20,
      payload: { options: [{ label: 'Lisbonne' }, { label: 'Madrid' }] },
    })
    expect(screen.getByText('Lisbonne')).toBeInTheDocument()
    expect(screen.queryByText('En attente des premières idées…')).toBeNull()
    expect(screen.getByText(/répondu/)).toBeInTheDocument()
  })
})

describe('BigScreen, nuage de mots à la révélation', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const five = [
    { key: 'a', text: 'alpha', count: 9 },
    { key: 'b', text: 'bravo', count: 7 },
    { key: 'c', text: 'charlie', count: 5 },
    { key: 'd', text: 'delta', count: 3 },
    { key: 'e', text: 'echo', count: 2 },
  ]

  async function toReveal() {
    renderBigScreen()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))
    emitServerEvent('question:show', cloudQuestion)
    await screen.findByText(cloudQuestion.prompt)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    emitServerEvent('wordcloud:update', view({ words: five }))
    emitServerEvent('question:reveal', { correct: null, distribution: {} })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
  }

  it('affiche le top 4 à la révélation', async () => {
    await toReveal()
    const list = screen.getByRole('list', { name: 'Mots les plus proposés' })
    expect(list.textContent).toContain('alpha')
    expect(list.textContent).toContain('delta')
    expect(list.textContent).not.toContain('echo')
  })

  it('retire un mot du top 4 pendant la révélation', async () => {
    await toReveal()
    emitServerEvent('wordcloud:update', view({ words: five.slice(1) }))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    const list = screen.getByRole('list', { name: 'Mots les plus proposés' })
    expect(list.textContent).not.toContain('alpha')
    expect(list.textContent).toContain('echo')
  })
})
