// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_LOAD_ID } from '../realtime/pageLoad'
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

function renderHostLive() {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/host/s1', state: { pin: '1234', quizTitle: 'Quiz Test', launch: PAGE_LOAD_ID } }]}
    >
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

const cloudQuestion = { id: 'q1', type: 'wordcloud', prompt: 'Un mot sur le café ?', timeLimit: 30, payload: {} }
const cloudView = {
  questionId: 'q1',
  words: [
    { key: 'cafe', text: 'café', count: 3 },
    { key: 'the', text: 'thé', count: 1 },
  ],
  participants: 3,
  totalWords: 4,
  truncated: true,
}

describe('HostLive, nuage de mots en direct', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async () => ({}))
  })
  afterEach(cleanup)

  it('affiche le nuage et les compteurs', () => {
    renderHostLive()
    emitServerEvent('question:show', cloudQuestion)
    expect(screen.getByText('En attente des premières idées…')).toBeInTheDocument()
    emitServerEvent('wordcloud:update', cloudView)
    expect(screen.getByText('café')).toBeInTheDocument()
    expect(screen.getByText(/3 participants ont proposé, 4 mots reçus/)).toBeInTheDocument()
    expect(screen.getByText(/\(100 mots les plus cités\)/)).toBeInTheDocument()
  })

  it('retirer un mot émet host:wordcloudRemove', async () => {
    renderHostLive()
    emitServerEvent('question:show', cloudQuestion)
    emitServerEvent('wordcloud:update', cloudView)
    fireEvent.click(screen.getByRole('button', { name: 'Retirer « café »' }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:wordcloudRemove', { word: 'café' }))
  })

  it("affiche l'erreur d'acquittement", async () => {
    mockEmitAck.mockImplementation(async (event?: string) => {
      if (event === 'host:wordcloudRemove') throw new Error('Mot introuvable.')
      return {}
    })
    renderHostLive()
    emitServerEvent('question:show', cloudQuestion)
    emitServerEvent('wordcloud:update', cloudView)
    fireEvent.click(screen.getByRole('button', { name: 'Retirer « café »' }))
    expect(await screen.findByText(/Mot introuvable/)).toBeInTheDocument()
  })

  it("un nouveau question:show efface l'ancien nuage", () => {
    renderHostLive()
    emitServerEvent('question:show', cloudQuestion)
    emitServerEvent('wordcloud:update', cloudView)
    emitServerEvent('question:show', { ...cloudQuestion, id: 'q2' })
    expect(screen.queryByText('café')).toBeNull()
  })

  it('masque la ligne de progression et intitule le bouton « Clore le nuage »', () => {
    const { container } = renderHostLive()
    emitServerEvent('question:show', cloudQuestion)
    expect(container.querySelector('.hostlive-progress[aria-hidden="true"]')).toBeNull()
    expect(screen.queryByText(/répondu/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Clore le nuage' })).toBeInTheDocument()
    expect(screen.queryByText('Révéler la réponse')).toBeNull()
  })

  it('clore le nuage émet host:reveal', async () => {
    renderHostLive()
    emitServerEvent('question:show', cloudQuestion)
    fireEvent.click(screen.getByRole('button', { name: 'Clore le nuage' }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:reveal', expect.anything()))
  })

  it('une question mcq garde le rendu actuel', () => {
    renderHostLive()
    emitServerEvent('question:show', {
      id: 'q3',
      type: 'mcq',
      prompt: 'Capitale ?',
      timeLimit: 20,
      payload: { options: [{ label: 'A' }, { label: 'B' }] },
    })
    expect(screen.getByText('Révéler la réponse')).toBeInTheDocument()
    expect(screen.getByText(/répondu/)).toBeInTheDocument()
    expect(screen.queryByText('En attente des premières idées…')).toBeNull()
  })
})
