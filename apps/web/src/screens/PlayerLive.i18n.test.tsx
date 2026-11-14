// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
import { MotionProvider } from '../motion/index.js'
import { clearPlayerSession, savePlayerSession } from '../realtime/playerSession'
import { Join } from './Join'
import { PlayerLive } from './PlayerLive'
import { ClosingView, ConversionFooter, PodiumView } from './Podium'

vi.mock('../motion/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../motion/index.js')>()
  return {
    ...actual,
    useCue: () => () => {},
    useSound: () => ({
      unlock: () => {},
      play: () => {},
      loop: () => {},
      stop: () => {},
      setMuted: () => {},
      muted: false,
    }),
  }
})

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()
const socketListeners: string[] = []

const mockEmitAck = vi.fn(async (event: string) => {
  if (event === 'player:reconnect') return { playerId: 'p1', phase: 'lobby', score: 0 }
  if (event === 'player:answer') return { accepted: true }
  return {}
})

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
      socketListeners.push(event)
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

describe('PlayerLive : traduction', () => {
  beforeEach(() => {
    handlers.clear()
    socketListeners.length = 0
    mockEmitAck.mockClear()
    savePlayerSession({ pin: '482913', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  it('passe de fr à es pendant une question ouverte sans se reconnecter, et la réponse reste possible', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    emitServerEvent('question:show', {
      id: 'q1',
      type: 'truefalse',
      prompt: 'Le manchot vole-t-il ?',
      timeLimit: 20,
      payload: {},
      index: 0,
      total: 3,
    })
    expect(await screen.findByText('Le premier appui valide ta réponse.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vrai/ })).toBeInTheDocument()

    const emitsBefore = mockEmitAck.mock.calls.length
    const listenersBefore = socketListeners.length

    act(() => setLang('es'))

    expect(screen.getByText('Tu primer toque envía la respuesta.')).toBeInTheDocument()
    expect(screen.getByText('Verdadero o falso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Verdadero/ })).toBeInTheDocument()
    // Le texte de l'hôte n'est jamais traduit.
    expect(screen.getByText('Le manchot vole-t-il ?')).toBeInTheDocument()
    // Ni nouvel abonnement ni nouvel emit : la connexion n'est pas touchée.
    expect(mockEmitAck.mock.calls.length).toBe(emitsBefore)
    expect(socketListeners.length).toBe(listenersBefore)

    fireEvent.click(screen.getByRole('button', { name: /Falso/ }))
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:answer', { answer: { value: false } }))
    expect(await screen.findByText('Respuesta registrada. Esperando lo siguiente…')).toBeInTheDocument()

    act(() => setLang('en'))
    expect(screen.getByText("Answer recorded. Waiting for what's next…")).toBeInTheDocument()
    expect(mockEmitAck.mock.calls.filter(([event]) => event === 'player:reconnect')).toHaveLength(1)
  })

  it("le sélecteur de langue du lobby retraduit l'écran sans nouvelle connexion", async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    expect(screen.getByRole('heading', { name: 'Tu es sur la banquise !' })).toBeInTheDocument()
    const emitsBefore = mockEmitAck.mock.calls.length

    fireEvent.change(screen.getByRole('combobox', { name: "Langue de l'interface" }), { target: { value: 'es' } })

    expect(screen.getByRole('heading', { name: '¡Estás en el témpano!' })).toBeInTheDocument()
    expect(mockEmitAck.mock.calls.length).toBe(emitsBefore)
  })

  it('traduit le lobby, le verdict et la fin de partie', async () => {
    setLang('en')
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    expect(screen.getByRole('heading', { name: "You're on the ice floe!" })).toBeInTheDocument()
    emitServerEvent('lobby:count', { count: 2 })
    expect(screen.getByText('penguins on the ice')).toBeInTheDocument()

    emitServerEvent('podium', { top: [{ playerId: 'p1', nickname: 'Ana', score: 1200 }] })
    expect(await screen.findByRole('heading', { name: 'Game over!' })).toBeInTheDocument()
    expect(screen.getByText('Final score: 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join another game' })).toBeInTheDocument()

    act(() => setLang('es'))
    expect(screen.getByRole('heading', { name: '¡Partida terminada!' })).toBeInTheDocument()
    expect(screen.getByText('1. Ana: 1200 puntos (tú)')).toBeInTheDocument()
  })
})

describe('Join : traduction', () => {
  afterEach(cleanup)

  it("retraduit l'erreur de validation affichée quand la langue change", () => {
    render(
      <MemoryRouter initialEntries={['/join']}>
        <Join />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre la colonie' }))
    expect(screen.getByText('Le PIN doit comporter exactement 6 chiffres.')).toBeInTheDocument()
    act(() => setLang('en'))
    expect(screen.getByText('The PIN must have exactly 6 digits.')).toBeInTheDocument()
    expect(screen.getByText('Nickname required. Pick a nickname to join.')).toBeInTheDocument()
  })

  it('affiche le formulaire en anglais puis en espagnol', () => {
    setLang('en')
    render(
      <MemoryRouter initialEntries={['/join']}>
        <Join />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Ice floe code')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join the colony' })).toBeInTheDocument()
    act(() => setLang('es'))
    expect(screen.getByLabelText('Código del témpano')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unirme a la colonia' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la colonia' }))
    expect(screen.getByText('El PIN debe tener exactamente 6 dígitos.')).toBeInTheDocument()
  })
})

describe('Podium : traduction', () => {
  afterEach(cleanup)

  const top = [
    { playerId: 'a', nickname: 'Ana', score: 300 },
    { playerId: 'b', nickname: 'Bob', score: 200 },
    { playerId: 'c', nickname: 'Cleo', score: 100 },
  ]

  it("titre, places pour lecteur d'écran et pied de page selon la langue", () => {
    setLang('en')
    render(
      <>
        <PodiumView top={top} showConversionFooter />
        <ClosingView audience="player" />
      </>,
    )
    expect(screen.getByRole('heading', { name: 'Final leaderboard' })).toBeInTheDocument()
    expect(screen.getByText('1st place')).toBeInTheDocument()
    expect(screen.getByText('3rd place')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the code' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Thanks for your answers' })).toBeInTheDocument()
    cleanup()

    setLang('es')
    render(<PodiumView top={top} />)
    expect(screen.getByRole('heading', { name: 'Clasificación final' })).toBeInTheDocument()
    expect(screen.getByText('2.º puesto')).toBeInTheDocument()
    render(<ConversionFooter />)
    expect(screen.getByRole('link', { name: 'Ver el código' })).toBeInTheDocument()
  })
})
