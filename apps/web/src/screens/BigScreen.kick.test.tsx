// @vitest-environment jsdom
import { act, cleanup, render, waitFor, within } from '@testing-library/react'
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

vi.mock('../realtime/hardReload', () => ({ hardReload: vi.fn() }))

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

function renderBigScreen(search: string) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[`/screen/s1?${search}`]}>
        <Routes>
          <Route path="/screen/:sessionId" element={<BigScreen />} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  )
}

const ana = { id: 'p-ana', nickname: 'Ana', score: 0, connected: true }
const bob = { id: 'p-bob', nickname: 'Bob', score: 0, connected: true }

describe('BigScreen, exclusion d\'un joueur', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  afterEach(cleanup)

  it('lobby : le joueur exclu disparaît de la liste, sans annonce', async () => {
    const { queryByText, container } = renderBigScreen('token=tok-abc&pin=1234')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalled())

    emitServerEvent('lobby:update', { players: [ana, bob] })
    expect(queryByText('Bob')).not.toBeNull()

    emitServerEvent('lobby:update', { players: [ana] })
    expect(queryByText('Bob')).toBeNull()
    expect(queryByText('Ana')).not.toBeNull()
    expect(container.textContent).not.toMatch(/exclu|retiré/i)
  })

  it('classement : le joueur exclu n\'apparaît plus après le lobby:update suivant', async () => {
    const { container } = renderBigScreen('token=tok-abc&pin=1234')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalled())

    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', { id: 'q1', type: 'mcq', prompt: 'Q ?', timeLimit: 20, payload: { options: [{ label: 'A' }, { label: 'B' }] } })
    emitServerEvent('question:reveal', { correct: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] }, distribution: { '0': 1 } })
    emitServerEvent('scoreboard', {
      ranking: [
        { playerId: 'p-bob', nickname: 'Bob', score: 200 },
        { playerId: 'p-ana', nickname: 'Ana', score: 100 },
      ],
    })

    await waitFor(() => expect(container.querySelector('.big-scoreboard__list')).not.toBeNull(), { timeout: 8000 })
    const list = () => container.querySelector('.big-scoreboard__list') as HTMLElement
    expect(within(list()).queryByText('Bob')).not.toBeNull()

    emitServerEvent('lobby:update', { players: [ana] })

    const names = Array.from(list().querySelectorAll('.big-scoreboard__name')).map((n) => n.textContent)
    expect(names).toEqual(['Ana'])
    expect(container.textContent).not.toMatch(/exclu|retiré/i)
  }, 15000)

  it("podium : le classement final suit le ranking du podium, sans l'exclu du dernier scoreboard", async () => {
    const { container, findByRole } = renderBigScreen('token=tok-abc&pin=1234')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalled())

    // Dernier scoreboard : Zoe (4e) y figure encore ; l'hôte l'exclut avant le podium.
    emitServerEvent('scoreboard', {
      ranking: [
        { playerId: 'p1', nickname: 'Ana', score: 500 },
        { playerId: 'p2', nickname: 'Bob', score: 400 },
        { playerId: 'p3', nickname: 'Cleo', score: 300 },
        { playerId: 'p-zoe', nickname: 'Zoe', score: 250 },
        { playerId: 'p4', nickname: 'Dan', score: 200 },
        { playerId: 'p5', nickname: 'Eve', score: 100 },
      ],
    })
    const ranking = [
      { playerId: 'p1', nickname: 'Ana', score: 500 },
      { playerId: 'p2', nickname: 'Bob', score: 400 },
      { playerId: 'p3', nickname: 'Cleo', score: 300 },
      { playerId: 'p4', nickname: 'Dan', score: 200 },
      { playerId: 'p5', nickname: 'Eve', score: 100 },
    ]
    emitServerEvent('podium', { top: ranking.slice(0, 3), ranking })

    const full = await findByRole('region', { name: 'Classement complet' })
    const names = Array.from(full.querySelectorAll('.podium-list__item > span:nth-child(2)')).map((n) => n.textContent)
    expect(names).toEqual(['Dan', 'Eve'])
    expect(container.textContent).not.toContain('Zoe')
  })
})
