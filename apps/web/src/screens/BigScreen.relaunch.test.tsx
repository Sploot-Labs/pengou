// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { hardReload } from '../realtime/hardReload'
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

describe('BigScreen, relance de partie (session:relaunched)', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    ;(hardReload as Mock).mockClear()
  })
  afterEach(cleanup)

  it('session:relaunched (écran) : recharge vers la nouvelle URL grand écran, titre reporté', async () => {
    renderBigScreen('token=tok-abc&pin=1234&title=Mon%20quiz')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))

    emitServerEvent('session:relaunched', { role: 'screen', pin: '777777', sessionId: 'sess-new', displayToken: 'tok-new' })

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(hardReload).toHaveBeenCalledWith(expect.stringContaining('/screen/sess-new'))
    const url = (hardReload as Mock).mock.calls[0][0] as string
    expect(url).toContain('token=tok-new')
    expect(url).toContain('pin=777777')
    expect(url).toContain('title=Mon+quiz')
  })

  it('session:relaunched (joueur) : ignoré par le grand écran', async () => {
    renderBigScreen('token=tok-abc&pin=1234')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalled())

    emitServerEvent('session:relaunched', { role: 'player', pin: '777777', sessionId: 'sess-new' })

    expect(hardReload).not.toHaveBeenCalled()
  })
})
