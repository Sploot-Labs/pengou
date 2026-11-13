// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_LOAD_ID } from '../realtime/pageLoad'
import { HostLive } from './HostLive'

// L'état de navigation (`location.state`) vit dans l'historique du navigateur : il survit à un
// rechargement de page, alors que l'autorité d'hôte, liée à la socket, n'y survit pas. Seul un état
// posé pendant CE chargement de page dispense l'écran hôte de demander la reprise au serveur.

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()
const mockEmitAck = vi.fn(async (_event?: string, _payload?: unknown): Promise<Record<string, unknown>> => ({}))

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

vi.mock('../api/quizzes', () => ({ listQuizzes: vi.fn(async () => []) }))

function renderHostLive(state: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/host/s1', state }]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

const reconnectCalls = () => mockEmitAck.mock.calls.filter(([event]) => event === 'host:reconnect')

describe('HostLive, rechargement de la page', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async (event?: string) =>
      event === 'host:reconnect' ? { sessionId: 's1', pin: '1234', phase: 'lobby' } : {},
    )
  })
  afterEach(cleanup)

  it("demande la reprise quand l'état de navigation vient d'un chargement de page précédent", async () => {
    renderHostLive({ pin: '1234', quizTitle: 'Quiz Test', launch: 'chargement-precedent' })
    await waitFor(() => expect(reconnectCalls()).toEqual([['host:reconnect', { sessionId: 's1' }]]))
    expect(await screen.findByText('Quiz Test')).toBeInTheDocument()
  })

  it("demande la reprise quand l'état de navigation ne dit pas d'où il vient", async () => {
    renderHostLive({ pin: '1234', quizTitle: 'Quiz Test' })
    await waitFor(() => expect(reconnectCalls()).toHaveLength(1))
  })

  it("ne demande rien quand la partie vient d'être lancée sur cette page", async () => {
    renderHostLive({ pin: '1234', quizTitle: 'Quiz Test', launch: PAGE_LOAD_ID })
    expect(await screen.findByText('Quiz Test')).toBeInTheDocument()
    expect(reconnectCalls()).toHaveLength(0)
  })
})
