// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostLive } from './HostLive'

/**
 * `HostLive` utilise la socket PARTAGÉE (`useSharedGameSocket`, voir le
 * commentaire en tête de `HostLive.tsx`) — même stratégie de mock que
 * `BigScreen.motion.test.tsx`/`PlayerLive.reading.test.tsx`, mais sur ce
 * module-ci plutôt que `useGameSocket`.
 */

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

/** Lancement direct (état de navigation `{pin, quizTitle}` déjà fourni par
 * `HostEditor` — voir `HostLive.tsx`) : pas de `host:reconnect` à attendre,
 * la partie démarre directement en 'lobby'. */
function renderHostLive() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/host/s1', state: { pin: '1234', quizTitle: 'Quiz Test' } }]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HostLive — phase lecture (question:reading)', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  afterEach(cleanup)

  it('question:reading affiche l’énoncé et un décompte textuel, sans aucun contrôle de pilotage', async () => {
    renderHostLive()

    emitServerEvent('question:reading', {
      prompt: 'Quelle est la capitale du Portugal ?',
      index: 0,
      total: 3,
      readingTime: 6,
      startedAt: Date.now(),
    })

    const heading = await screen.findByText('Quelle est la capitale du Portugal ?')
    expect(heading.tagName).toBe('H2')

    // Badge de phase + décompte textuel (RGAA — jamais seulement une
    // animation), et aucun contrôle de pilotage tant que le serveur n'a pas
    // révélé les réponses (la lecture est planifiée et annulée côté serveur,
    // pas l'hôte).
    expect(screen.getByText('Lecture en cours')).toBeInTheDocument()
    expect(screen.getByText(/Lecture en cours… \d+ s restantes/)).toBeInTheDocument()
    expect(screen.queryByText('Révéler la réponse')).toBeNull()
    expect(screen.queryByText('Passer')).toBeNull()

    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('question:show bascule ensuite vers le pilotage normal (contrôles hôte visibles)', async () => {
    renderHostLive()

    emitServerEvent('question:reading', {
      prompt: 'Quelle est la capitale du Portugal ?',
      index: 0,
      total: 3,
      readingTime: 6,
      startedAt: Date.now(),
    })
    await screen.findByText('Quelle est la capitale du Portugal ?')

    emitServerEvent('question:show', {
      id: 'q1',
      type: 'mcq',
      prompt: 'Quelle est la capitale du Portugal ?',
      timeLimit: 20,
      payload: { options: [{ label: 'Lisbonne' }, { label: 'Madrid' }, { label: 'Porto' }, { label: 'Séville' }] },
    })

    await waitFor(() => expect(screen.queryByText('Lecture en cours')).toBeNull())
    expect(screen.getByText('Question en cours')).toBeInTheDocument()
    expect(screen.getByText('Révéler la réponse')).toBeInTheDocument()
    expect(screen.queryByText(/Lecture en cours… \d+ s restantes/)).toBeNull()
  })

  it('host:reconnect en phase « reading » (snapshot Task 3) atterrit sur l’état lecture', async () => {
    mockEmitAck.mockImplementation(async (event?: string): Promise<Record<string, unknown>> => {
      if (event === 'host:reconnect') return { sessionId: 's1', pin: '1234', phase: 'reading' }
      return {}
    })

    render(
      <MemoryRouter initialEntries={['/host/s1']}>
        <Routes>
          <Route path="/host/:sessionId" element={<HostLive />} />
        </Routes>
      </MemoryRouter>,
    )

    // Le serveur émet `question:reading` (via `emitReconnectSnapshot`) AVANT
    // de répondre à l'ack `host:reconnect` — voir le commentaire de
    // `emitReconnectSnapshot`, game-gateway.ts.
    emitServerEvent('lobby:update', { players: [] })
    emitServerEvent('question:reading', {
      prompt: 'Question reprise en pleine lecture',
      index: 1,
      total: 3,
      readingTime: 6,
      startedAt: Date.now(),
    })

    const heading = await screen.findByText('Question reprise en pleine lecture')
    expect(heading.tagName).toBe('H2')
    expect(screen.getByText('Lecture en cours')).toBeInTheDocument()
  })
})
