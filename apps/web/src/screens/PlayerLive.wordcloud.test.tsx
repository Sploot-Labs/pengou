// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { savePlayerSession, clearPlayerSession } from '../realtime/playerSession'
import { PlayerLive } from './PlayerLive'

/**
 * `PlayerLive` ouvre sa PROPRE socket (`useGameSocket`, comme `BigScreen` —
 * voir le commentaire en tête de `BigScreen.motion.test.tsx`) : même stratégie
 * de mock, pour rejouer `question:reading`/`question:show` sans réseau réel.
 */

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()

/** `player:reconnect` doit répondre avec une forme réaliste (voir
 * `game-gateway.ts`) — un simple `{}` par défaut laisserait `score` à
 * `undefined` et polluerait le rendu (« Score : undefined ») sans rapport
 * avec ce que ces tests vérifient. */
const mockEmitAck = vi.fn(async (event: string) => {
  if (event === 'player:reconnect') {
    return { playerId: 'p1', phase: 'lobby', score: 0 }
  }
  if (event === 'player:answer') return nextAnswerAck()
  return {}
})

type Ack = { accepted: boolean; reason?: string; words?: string[] }
let answerAcks: Ack[] = []
function nextAnswerAck(): Ack {
  return answerAcks.shift() ?? { accepted: false, reason: 'hors phase question' }
}

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

function renderPlayerLive() {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={['/play']}>
        <Routes>
          <Route path="/play" element={<PlayerLive />} />
          <Route path="/join" element={<p>Rejoindre</p>} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  )
}

describe('PlayerLive nuage de mots', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    answerAcks = []
    savePlayerSession({ pin: '1234', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  async function startWordcloud() {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    emitServerEvent('question:show', {
      id: 'q1',
      type: 'wordcloud',
      prompt: 'Un mot sur les pingouins ?',
      timeLimit: 30,
      payload: {},
    })
    return screen.findByPlaceholderText('Un mot ou deux')
  }

  async function send(input: HTMLElement, word: string) {
    fireEvent.change(input, { target: { value: word } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
  }

  it('deux envois successifs restent en phase question et listent les deux mots', async () => {
    const input = await startWordcloud()
    expect(input).toHaveAttribute('maxlength', '25')
    expect(screen.getByText("25 caractères max, jusqu'à 20 idées")).toBeInTheDocument()

    answerAcks.push({ accepted: true, words: ['banquise'] })
    await send(input, 'banquise')
    await screen.findByText('banquise')
    expect(mockEmitAck).toHaveBeenCalledWith('player:answer', { answer: { word: 'banquise' } })
    expect(input).toHaveValue('')
    expect(input).toBeEnabled()
    await waitFor(() => expect(document.activeElement).toBe(input))

    answerAcks.push({ accepted: true, words: ['banquise', 'poisson'] })
    await send(input, 'poisson')
    await screen.findByText('poisson')
    expect(screen.getByText('banquise')).toBeInTheDocument()
    expect(screen.getByText('Tes idées envoyées')).toBeInTheDocument()
    expect(screen.queryByText(/Réponse enregistrée/)).toBeNull()
  })

  it("la liste ne survit pas d'une question nuage à la suivante", async () => {
    const input = await startWordcloud()
    answerAcks.push({ accepted: true, words: ['banquise'] })
    await send(input, 'banquise')
    await screen.findByText('banquise')
    emitServerEvent('question:show', {
      id: 'q2',
      type: 'wordcloud',
      prompt: 'Un autre mot ?',
      timeLimit: 30,
      payload: {},
    })
    await screen.findByText('Un autre mot ?')
    expect(screen.queryByText('banquise')).toBeNull()
  })

  it('un refus s’affiche en alerte et conserve le champ', async () => {
    const input = await startWordcloud()
    answerAcks.push({ accepted: false, reason: 'mot déjà envoyé' })
    await send(input, 'banquise')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('mot déjà envoyé')
    expect(input).toHaveValue('banquise')
    expect(input).toBeEnabled()
  })

  it('après reconnexion, la liste de l’acquittement remplace la liste locale', async () => {
    const input = await startWordcloud()
    answerAcks.push({ accepted: true, words: ['a', 'b', 'c'] })
    await send(input, 'c')
    await screen.findByText('a')
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('c')).toBeInTheDocument()
  })

  it('question:reveal affiche un verdict neutre', async () => {
    await startWordcloud()
    emitServerEvent('question:reveal', { correct: null, distribution: {} })
    const title = await screen.findByText('Merci pour tes idées')
    expect(title.closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByText('Résultat indisponible')).toBeNull()
  })

  it('à la fin du chrono, message de remerciement', async () => {
    await startWordcloud()
    emitServerEvent('timer', { timeLimit: 30, startedAt: Date.now() - 31000 })
    expect(await screen.findByText('Temps écoulé, merci pour tes idées')).toBeInTheDocument()
  })
})
