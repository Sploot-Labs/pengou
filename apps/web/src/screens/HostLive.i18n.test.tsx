// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
import { AckError } from '../realtime/ackError'
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

function renderHostLive(state: Record<string, unknown> = { quizTitle: 'Quiz Test' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/host/s1', state: { pin: '1234', launch: PAGE_LOAD_ID, ...state } }]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ana = { id: 'p1', nickname: 'Ana', score: 0, connected: true }
const bob = { id: 'p2', nickname: 'Bob', score: 0, connected: true }

describe('HostLive, traduction', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async () => ({}))
  })
  afterEach(() => {
    cleanup()
    setLang('fr')
    vi.restoreAllMocks()
  })

  it('compteur de joueurs au salon : 0, 1 puis 2 en français', () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [] })
    expect(screen.getByText('0 joueur')).toBeTruthy()
    emitServerEvent('lobby:update', { players: [ana] })
    expect(screen.getByText('1 joueur')).toBeTruthy()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    expect(screen.getByText('2 joueurs')).toBeTruthy()
  })

  it('compteur de joueurs au salon : 0, 1 puis 2 en anglais', () => {
    setLang('en')
    renderHostLive()
    emitServerEvent('lobby:update', { players: [] })
    expect(screen.getByText('0 players')).toBeTruthy()
    emitServerEvent('lobby:update', { players: [ana] })
    expect(screen.getByText('1 player')).toBeTruthy()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    expect(screen.getByText('2 players')).toBeTruthy()
  })

  it('compteur de joueurs au salon : 0, 1 puis 2 en espagnol', () => {
    setLang('es')
    renderHostLive()
    emitServerEvent('lobby:update', { players: [] })
    expect(screen.getByText('0 jugadores')).toBeTruthy()
    emitServerEvent('lobby:update', { players: [ana] })
    expect(screen.getByText('1 jugador')).toBeTruthy()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    expect(screen.getByText('2 jugadores')).toBeTruthy()
  })

  it("le salon s'affiche en anglais puis en espagnol", () => {
    setLang('en')
    renderHostLive()
    expect(screen.getByRole('heading', { name: 'Waiting for players' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start the game' })).toBeTruthy()
    act(() => setLang('es'))
    expect(screen.getByRole('heading', { name: 'Esperando a los jugadores' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Iniciar la partida' })).toBeTruthy()
  })

  it("le changement de langue retraduit l'écran sans le remonter", () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    expect(screen.getByRole('button', { name: 'Exclure Ana' })).toBeTruthy()
    act(() => setLang('en'))
    expect(screen.getByRole('button', { name: 'Kick Ana' })).toBeTruthy()
    expect(screen.getByText('1 player')).toBeTruthy()
  })
  it("refus « réservé à l'hôte » reconnu par son code quand le serveur répond en anglais", async () => {
    setLang('en')
    mockEmitAck.mockImplementation(async (event?: string) => {
      if (event === 'host:start') throw new AckError('action reserved for the game host', 'NOT_HOST')
      return {}
    })
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    fireEvent.click(screen.getByRole('button', { name: 'Start the game' }))
    expect(await screen.findByText(/this game can no longer be run from this tab/)).toBeTruthy()
    expect(screen.queryByText('action reserved for the game host')).toBeNull()
  })

  it("sans titre de quiz, le lien du grand écran ne porte pas le repli traduit de l'hôte", async () => {
    setLang('en')
    mockEmitAck.mockImplementation(async (event?: string) =>
      event === 'host:createScreenToken' ? { displayToken: 'tok' } : {},
    )
    renderHostLive({})
    expect(screen.getByText('Live game')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    const input = (await screen.findByLabelText('Big screen link')) as HTMLInputElement
    await waitFor(() => expect(input.value).toContain('token=tok'))
    expect(new URL(input.value).searchParams.has('title')).toBe(false)
    expect(input.value).not.toContain('Live')
  })

  it("le lien du grand écran ouvre le projecteur dans la langue courante de l'hôte", async () => {
    setLang('en')
    mockEmitAck.mockImplementation(async (event?: string) =>
      event === 'host:createScreenToken' ? { displayToken: 'tok' } : {},
    )
    renderHostLive()
    fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    const input = (await screen.findByLabelText('Big screen link')) as HTMLInputElement
    await waitFor(() => expect(input.value).toContain('token=tok'))
    expect(new URL(input.value).searchParams.get('lang')).toBe('en')
  })
})
