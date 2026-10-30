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

function renderHostLive() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/host/s1', state: { pin: '1234', quizTitle: 'Quiz Test' } }]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ana = { id: 'p1', nickname: 'Ana', score: 0, connected: true }
const bob = { id: 'p2', nickname: 'Bob', score: 0, connected: true }

const questionShow = {
  id: 'q1',
  type: 'mcq',
  prompt: 'Quelle est la capitale du Portugal ?',
  timeLimit: 20,
  payload: { options: [{ label: 'Lisbonne' }, { label: 'Madrid' }, { label: 'Porto' }, { label: 'Séville' }] },
}

describe('HostLive, exclusion d\'un joueur', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async () => ({}))
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lobby : confirmer « Exclure Ana » émet host:kick { playerId }', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
    expect(window.confirm).toHaveBeenCalledWith('Exclure Ana de la partie ?')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:kick', { playerId: 'p1' }))
  })

  it('annuler la confirmation n\'émet rien', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mockEmitAck).not.toHaveBeenCalledWith('host:kick', expect.anything())
  })

  it('en jeu (première question) : le tableau liste les joueurs présents avec un bouton Exclure', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', questionShow)
    expect(await screen.findByRole('button', { name: 'Exclure Bob' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exclure Ana' })).toBeInTheDocument()
  })

  it('le joueur exclu disparaît du tableau au lobby:update suivant, même s\'il reste dans le dernier scoreboard', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', questionShow)
    emitServerEvent('scoreboard', {
      ranking: [
        { playerId: 'p1', nickname: 'Ana', score: 800 },
        { playerId: 'p2', nickname: 'Bob', score: 500 },
      ],
    })
    await screen.findByRole('button', { name: 'Exclure Bob' })
    emitServerEvent('lobby:update', { players: [ana] })
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Exclure Bob' })).toBeNull()
  })

  it('une erreur d\'ack est affichée', async () => {
    mockEmitAck.mockImplementation(async (event?: string) => {
      if (event === 'host:kick') throw new Error('exclusion impossible au podium')
      return {}
    })
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
    expect(await screen.findByText('exclusion impossible au podium')).toBeInTheDocument()
  })
})
