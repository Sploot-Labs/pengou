// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
import { hardReload } from '../realtime/hardReload'
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

vi.mock('../realtime/hardReload', () => ({ hardReload: vi.fn() }))

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

const WAITING_EN = 'Waiting for the colony… Enter the ice floe code to join.'

describe('BigScreen, traduction', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    vi.mocked(hardReload).mockClear()
  })
  afterEach(() => {
    cleanup()
    setLang('fr')
  })

  it("texte d'attente du salon en anglais puis en espagnol", async () => {
    setLang('en')
    renderBigScreen()
    expect(await screen.findByText(WAITING_EN)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'The open-source live quiz.' })).toBeTruthy()
    act(() => setLang('es'))
    expect(screen.getByText('Esperando a la colonia… Introduce el código del témpano para unirte.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'El quiz en vivo de código abierto.' })).toBeTruthy()
  })

  it('annonce des joueurs arrivés, avec le pluriel de la langue', async () => {
    setLang('en')
    renderBigScreen()
    await screen.findByText(WAITING_EN)
    emitServerEvent('lobby:update', { players: [{ id: 'p1', nickname: 'Ana', score: 0, connected: true }] })
    await waitFor(() => expect(screen.getByText('1 player has joined the game.')).toBeTruthy())
    emitServerEvent('lobby:update', {
      players: [
        { id: 'p1', nickname: 'Ana', score: 0, connected: true },
        { id: 'p2', nickname: 'Bob', score: 0, connected: true },
      ],
    })
    await waitFor(() => expect(screen.getByText('2 players have joined the game.')).toBeTruthy())
  })

  it("le rappel d'adhésion et l'étiquette de phase suivent la langue", async () => {
    setLang('en')
    renderBigScreen()
    await screen.findByText(WAITING_EN)
    emitServerEvent('question:show', {
      id: 'q1',
      type: 'mcq',
      prompt: 'Capitale ?',
      timeLimit: 20,
      payload: { options: [{ label: 'A' }, { label: 'B' }] },
    })
    expect(await screen.findByText('Question in progress')).toBeTruthy()
    expect(screen.getByText(/ice floe code/)).toBeTruthy()
    act(() => setLang('es'))
    expect(screen.getByText('Pregunta en curso')).toBeTruthy()
    expect(screen.getByText(/código del témpano/)).toBeTruthy()
  })
  it("la relance ne fige pas le repli traduit dans l'URL du grand écran", async () => {
    setLang('en')
    renderBigScreen()
    await screen.findByText(WAITING_EN)
    emitServerEvent('session:relaunched', { role: 'screen', sessionId: 's2', displayToken: 'tok2', pin: '5678' })
    expect(hardReload).toHaveBeenCalledTimes(1)
    const target = vi.mocked(hardReload).mock.calls[0][0]
    expect(target).toContain('token=tok2')
    expect(target).not.toContain('title=')
  })
})
