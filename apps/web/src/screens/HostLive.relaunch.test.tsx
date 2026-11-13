// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hardReload } from '../realtime/hardReload'
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

vi.mock('../api/quizzes', () => ({
  listQuizzes: vi.fn(async () => [
    { id: 'quizA', title: 'Quiz A' },
    { id: 'quizB', title: 'Quiz B' },
  ]),
}))

vi.mock('../realtime/hardReload', () => ({ hardReload: vi.fn() }))

// Le composant réel lit la session : ici, seul son montage au podium est vérifié.
vi.mock('../ui/GuestSignupOffer', () => ({ GuestSignupOffer: () => <p>Offre à l'hôte invité</p> }))

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

describe('HostLive, relance au podium', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    vi.mocked(hardReload).mockClear()
    mockEmitAck.mockImplementation(async (event?: string) =>
      event === 'host:relaunch' ? { sessionId: 'sess-new', pin: '777777' } : {},
    )
  })
  afterEach(cleanup)

  it('podium : relancer sur un quiz choisi émet host:relaunch puis recharge /host/:nouvelId', async () => {
    renderHostLive()
    emitServerEvent('podium', { top: [{ playerId: 'p1', nickname: 'Ana', score: 10, rank: 1 }] })

    const select = await screen.findByLabelText('Quiz de la prochaine partie')
    await screen.findByRole('option', { name: 'Quiz B' })
    fireEvent.change(select, { target: { value: 'quizB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Relancer une partie' }))

    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:relaunch', { quizId: 'quizB' }))
    await waitFor(() => expect(hardReload).toHaveBeenCalledWith('/host/sess-new'))
  })

  it('erreur de relance : affichée, pas de rechargement', async () => {
    mockEmitAck.mockImplementation(async (event?: string) => {
      if (event === 'host:relaunch') throw new Error('boom')
      return {}
    })
    renderHostLive()
    emitServerEvent('podium', { top: [] })
    await screen.findByRole('option', { name: 'Quiz A' })
    fireEvent.click(screen.getByRole('button', { name: 'Relancer une partie' }))

    await screen.findByRole('alert')
    expect(hardReload).not.toHaveBeenCalled()
  })

  it('aucun quiz : message à la place du sélecteur et du bouton', async () => {
    const { listQuizzes } = await import('../api/quizzes')
    vi.mocked(listQuizzes).mockResolvedValueOnce([])
    renderHostLive()
    emitServerEvent('podium', { top: [] })

    await screen.findByText('Aucun quiz disponible à relancer.')
    expect(screen.queryByRole('button', { name: 'Relancer une partie' })).toBeNull()
  })

  it("podium : l'offre d'inscription à l'hôte invité est montée", async () => {
    renderHostLive()
    expect(screen.queryByText("Offre à l'hôte invité")).not.toBeInTheDocument()
    emitServerEvent('podium', { top: [] })
    expect(await screen.findByText("Offre à l'hôte invité")).toBeInTheDocument()
  })

  it('pas de contrôle de relance hors podium', () => {
    renderHostLive()
    expect(screen.queryByRole('button', { name: 'Relancer une partie' })).toBeNull()
  })
})
