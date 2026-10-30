// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { clearPlayerSession, loadPlayerSession, savePlayerSession } from '../realtime/playerSession'
import { hardReload } from '../realtime/hardReload'
import { AckError } from '../realtime/ackError'
import { PlayerLive } from './PlayerLive'

/**
 * Fin de partie (podium) : le joueur doit pouvoir repartir vers `/join` pour
 * enchaîner une autre partie. Même stratégie de mock socket que
 * `PlayerLive.arcade.test.tsx`.
 */

vi.mock('../motion/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../motion/index.js')>()
  return {
    ...actual,
    useCue: () => () => {},
    useSound: () => ({ unlock: () => {}, play: () => {}, loop: () => {}, stop: () => {}, setMuted: () => {}, muted: false }),
  }
})

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()

const mockEmitAck = vi.fn(async (event: string) => {
  if (event === 'player:reconnect') return { playerId: 'p1', phase: 'lobby', score: 0 }
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

describe('PlayerLive — enchaîner une partie depuis le podium', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    savePlayerSession({ pin: '482913', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  it('affiche un bouton « rejoindre une autre partie » au podium', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    // Avant la fin de partie : aucun bouton de ce genre.
    expect(screen.queryByRole('button', { name: /rejoindre une autre partie/i })).toBeNull()

    emitServerEvent('podium', { top: [{ playerId: 'p1', nickname: 'Ana', score: 1200 }] })

    await screen.findByText('Partie terminée !')
    expect(screen.getByRole('button', { name: /rejoindre une autre partie/i })).toBeInTheDocument()
  })

  it('au clic : efface la session joueur et redirige vers /join', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('podium', { top: [{ playerId: 'p1', nickname: 'Ana', score: 1200 }] })
    const button = await screen.findByRole('button', { name: /rejoindre une autre partie/i })

    fireEvent.click(button)

    // On atterrit sur /join et l'identité de la partie précédente est oubliée
    // (sinon PlayerLive tenterait de se reconnecter à l'ancienne room).
    expect(await screen.findByText('Rejoindre')).toBeInTheDocument()
    expect(loadPlayerSession()).toBeNull()
  })
})

describe('PlayerLive : adoption de la partie relancée', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    vi.mocked(hardReload).mockClear()
    savePlayerSession({ pin: '482913', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  it('session:relaunched (joueur) : enregistre la nouvelle identité et recharge /play', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    emitServerEvent('session:relaunched', { role: 'player', pin: '777777', playerId: 'p9', joinToken: 'tok9', nickname: 'Ana' })
    expect(loadPlayerSession()).toMatchObject({ pin: '777777', playerId: 'p9', joinToken: 'tok9', nickname: 'Ana' })
    expect(hardReload).toHaveBeenCalledWith('/play')
  })

  it('session:relaunched (écran) : ignoré', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    emitServerEvent('session:relaunched', { role: 'screen', pin: '777777', sessionId: 's9', displayToken: 'd9' })
    expect(loadPlayerSession()).toMatchObject({ pin: '482913', playerId: 'p1' })
    expect(hardReload).not.toHaveBeenCalled()
  })
})

describe("PlayerLive : exclusion par l'animateur", () => {
  const defaultAck = async (event: string) => {
    if (event === 'player:reconnect') return { playerId: 'p1', phase: 'lobby', score: 0 }
    return {}
  }
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(defaultAck)
    savePlayerSession({ pin: '482913', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(defaultAck)
  })

  it('player:kicked : efface la session locale et affiche le message avec un lien vers /join', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    emitServerEvent('player:kicked', {})
    expect(await screen.findByText("L'animateur t'a retiré de la partie.")).toBeTruthy()
    expect(loadPlayerSession()).toBeNull()
    expect(screen.getByRole('link', { name: 'Rejoindre une partie' }).getAttribute('href')).toBe('/join')
  })

  it('reconnexion refusée pour exclusion : même écran, pas de redirection silencieuse', async () => {
    mockEmitAck.mockImplementation(async (event: string) => {
      if (event === 'player:reconnect') throw new AckError('joueur exclu de la partie', 'kicked')
      return {}
    })
    renderPlayerLive()
    expect(await screen.findByText("L'animateur t'a retiré de la partie.")).toBeTruthy()
    expect(loadPlayerSession()).toBeNull()
    expect(screen.queryByText('Rejoindre')).toBeNull()
  })

  it('autre échec de reconnexion : comportement inchangé (redirection vers /join)', async () => {
    mockEmitAck.mockImplementation(async (event: string) => {
      if (event === 'player:reconnect') throw new Error('joinToken invalide')
      return {}
    })
    renderPlayerLive()
    expect(await screen.findByText('Rejoindre')).toBeTruthy()
    expect(screen.queryByText("L'animateur t'a retiré de la partie.")).toBeNull()
  })
})
