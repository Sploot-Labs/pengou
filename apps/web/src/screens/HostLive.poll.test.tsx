// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostLive } from './HostLive'

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()
const mockEmitAck = vi.fn(async (_event?: string, _payload?: unknown): Promise<Record<string, unknown>> => ({}))

function emitServerEvent(event: string, payload: unknown) {
  act(() => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  })
}

vi.mock('../realtime/GameSocketProvider', () => ({
  useSharedGameSocket: () => ({
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

function renderHostLive(state: Record<string, unknown> | null = { pin: '1234', quizTitle: 'Quiz Test' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/host/s1', state }]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

const pollQuestion = {
  id: 'p1',
  type: 'poll',
  prompt: 'Boisson préférée ?',
  timeLimit: 20,
  payload: { options: [{ label: 'Café' }, { label: 'Thé' }], multiple: true },
}

const pollReveal = {
  correct: null,
  distribution: {},
  poll: {
    questionId: 'p1',
    multiple: true,
    voters: 3,
    options: [
      { label: 'Café', votes: 2 },
      { label: 'Thé', votes: 1 },
    ],
  },
}

const ranking = { ranking: [{ playerId: 'a', nickname: 'Alice', score: 0 }] }

describe('HostLive, sondage', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async () => ({}))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('pendant la question : « Clore le sondage », « Passer » et la mention du choix multiple', () => {
    renderHostLive()
    emitServerEvent('question:show', pollQuestion)
    expect(screen.getByRole('button', { name: 'Clore le sondage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Passer' })).toBeInTheDocument()
    expect(screen.queryByText('Révéler la réponse')).toBeNull()
    expect(screen.getByText('Plusieurs réponses possibles')).toBeInTheDocument()
    expect(screen.getByText(/répondu/)).toBeInTheDocument()
  })

  it('clore le sondage émet host:reveal', async () => {
    renderHostLive()
    emitServerEvent('question:show', pollQuestion)
    fireEvent.click(screen.getByRole('button', { name: 'Clore le sondage' }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:reveal', expect.anything()))
  })

  it('passer un sondage émet host:skip et ne bloque pas la révélation de la question suivante', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderHostLive()
    emitServerEvent('question:show', pollQuestion)
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:skip', expect.anything()))
    // Le serveur enchaîne directement (aucune révélation, aucun classement).
    emitServerEvent('question:show', { ...pollQuestion, id: 'p2', prompt: 'Dessert préféré ?' })
    emitServerEvent('question:reveal', { ...pollReveal, poll: { ...pollReveal.poll, questionId: 'p2' } })
    expect(screen.getByText('Révélation : Dessert préféré ?')).toBeInTheDocument()
  })

  it('en révélation : répartition en votes et pourcentages, « Suivant » à la place du classement', async () => {
    renderHostLive()
    emitServerEvent('question:show', pollQuestion)
    emitServerEvent('question:reveal', pollReveal)
    expect(screen.getByText('67 %')).toBeInTheDocument()
    expect(screen.getByText('33 %')).toBeInTheDocument()
    expect(screen.queryByText(/Bonne réponse/)).toBeNull()
    expect(screen.getByText('Sondage clos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Afficher le classement' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:next', expect.anything()))
  })

  it('sans aucun votant, affiche « Aucun vote »', () => {
    renderHostLive()
    emitServerEvent('question:show', pollQuestion)
    emitServerEvent('question:reveal', {
      ...pollReveal,
      poll: { ...pollReveal.poll, voters: 0, options: [{ label: 'Café', votes: 0 }, { label: 'Thé', votes: 0 }] },
    })
    expect(screen.getByText('Aucun vote')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it('un scoreboard reçu ne change pas la phase', () => {
    renderHostLive()
    emitServerEvent('question:show', pollQuestion)
    emitServerEvent('question:reveal', pollReveal)
    emitServerEvent('scoreboard', ranking)
    expect(screen.getByText('Révélation : Boisson préférée ?')).toBeInTheDocument()
    expect(screen.getByText('67 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeInTheDocument()
  })

  it('après un host:reconnect en phase reveal, la répartition s\'affiche (jamais le classement)', async () => {
    mockEmitAck.mockImplementation(async (event?: string): Promise<Record<string, unknown>> => {
      if (event === 'host:reconnect') return { sessionId: 's1', pin: '1234', phase: 'reveal' }
      return {}
    })
    renderHostLive(null)
    // Le serveur rejoue la question et sa révélation, puis émet encore `scoreboard`, avant l'ack.
    emitServerEvent('lobby:update', { players: [] })
    emitServerEvent('question:show', pollQuestion)
    emitServerEvent('question:reveal', pollReveal)
    emitServerEvent('scoreboard', ranking)
    expect(await screen.findByText('Révélation : Boisson préférée ?')).toBeInTheDocument()
    expect(screen.getByText('67 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Classement' })).toBeNull()
  })

  it('la révélation d\'un nuage de mots offre aussi « Suivant »', async () => {
    renderHostLive()
    emitServerEvent('question:show', { id: 'w1', type: 'wordcloud', prompt: 'Un mot ?', timeLimit: 30, payload: {} })
    emitServerEvent('question:reveal', { correct: null, distribution: {} })
    emitServerEvent('scoreboard', ranking)
    expect(screen.queryByRole('button', { name: 'Afficher le classement' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:next', expect.anything()))
  })

  it('un QCM garde « Afficher le classement » (non-régression)', () => {
    renderHostLive()
    emitServerEvent('question:show', {
      id: 'q3',
      type: 'mcq',
      prompt: 'Capitale ?',
      timeLimit: 20,
      payload: { options: [{ label: 'A' }, { label: 'B' }] },
    })
    emitServerEvent('question:reveal', {
      correct: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
      distribution: {},
    })
    expect(screen.getByRole('button', { name: 'Afficher le classement' })).toBeInTheDocument()
  })
})

describe('HostLive, fin de partie sans question notée', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async () => ({}))
  })
  afterEach(cleanup)

  it('hasScoredQuestions faux : « Merci pour vos réponses » et le bloc de relance', () => {
    renderHostLive()
    emitServerEvent('podium', { top: [], sources: [], hasScoredQuestions: false })
    expect(screen.getByRole('heading', { name: 'Merci pour vos réponses' })).toBeInTheDocument()
    expect(screen.queryByText('Classement final')).toBeNull()
    expect(document.querySelector('.hostlive-relaunch')).not.toBeNull()
  })

  it('hasScoredQuestions vrai avec des scores à 0 : le podium reste', () => {
    renderHostLive()
    emitServerEvent('podium', {
      top: [{ playerId: 'a', nickname: 'Alice', score: 0 }],
      sources: [],
      hasScoredQuestions: true,
    })
    expect(screen.getByText('Classement final')).toBeInTheDocument()
    expect(screen.queryByText('Merci pour vos réponses')).toBeNull()
  })
})