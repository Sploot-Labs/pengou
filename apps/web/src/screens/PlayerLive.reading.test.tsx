// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { savePlayerSession, clearPlayerSession } from '../realtime/playerSession'
import { PlayerLive } from './PlayerLive'

/**
 * `PlayerLive` ouvre sa PROPRE socket (`useGameSocket`, comme `BigScreen` —
 * voir le commentaire en tête de `BigScreen.motion.test.tsx`) : même stratégie
 * de mock, pour rejouer `question:reading`/`question:show` sans réseau réel.
 */

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()

/** `player:reconnect` doit répondre avec une forme réaliste (voir
 * `game-gateway.ts`) — un simple `{}` par défaut laisserait `score` à
 * `undefined` et polluerait le rendu (« Score : undefined ») sans rapport
 * avec ce que ces tests vérifient. */
const mockEmitAck = vi.fn(async (event: string) => {
  if (event === 'player:reconnect') {
    return { playerId: 'p1', phase: 'lobby', score: 0 }
  }
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

describe('PlayerLive — phase lecture (question:reading)', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    savePlayerSession({ pin: '1234', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  it('question:reading affiche l’énoncé et « Prépare-toi… », sans aucune tuile de réponse cliquable', async () => {
    renderPlayerLive()

    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('question:reading', {
      prompt: 'Quelle est la capitale du Portugal ?',
      index: 0,
      total: 3,
      readingTime: 6,
      startedAt: Date.now(),
    })

    const heading = await screen.findByText('Quelle est la capitale du Portugal ?')
    expect(heading.tagName).toBe('H1')

    // Annonce RGAA de l'entrée en lecture — texte toujours présent (pas
    // seulement une animation/couleur).
    const status = screen.getByText('Prépare-toi…')
    expect(status.closest('[role="status"]')).not.toBeNull()

    // Aucune saisie possible pendant la lecture : ni tuile mcq, ni bouton
    // vrai/faux, ni champ texte/slider — cohérent avec le rejet serveur des
    // réponses hors phase 'question' (le payload `question:reading` n'a de
    // toute façon aucune option à afficher). Le seul bouton présent est le
    // contrôle de son global (coupe/active le son), jamais une réponse.
    expect(document.querySelector('.player-tiles')).toBeNull()
    expect(document.querySelector('.player-duo')).toBeNull()
    expect(document.querySelector('.player-text')).toBeNull()
    expect(document.querySelector('.player-slider')).toBeNull()
    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName(/son/i)
    expect(document.querySelector('input')).toBeNull()

    // Focus RGAA 2.4.3 : le titre de la nouvelle phase reçoit le focus au montage.
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('question:show bascule ensuite vers la phase question, avec les tuiles de réponse activées', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('question:reading', {
      prompt: 'Quelle est la capitale du Portugal ?',
      index: 0,
      total: 3,
      readingTime: 6,
      startedAt: Date.now(),
    })
    await screen.findByText('Quelle est la capitale du Portugal ?')
    expect(screen.getByText('Prépare-toi…')).toBeInTheDocument()

    emitServerEvent('question:show', {
      id: 'q1',
      type: 'mcq',
      prompt: 'Quelle est la capitale du Portugal ?',
      timeLimit: 20,
      payload: { options: [{ label: 'Lisbonne' }, { label: 'Madrid' }, { label: 'Porto' }, { label: 'Séville' }] },
    })

    await screen.findByText('Lisbonne')
    const tile = screen.getByRole('button', { name: /Lisbonne/ })
    expect(tile).toBeEnabled()

    // Le message de lecture a disparu avec la bascule de phase.
    expect(screen.queryByText('Prépare-toi…')).toBeNull()
  })
})

describe('PlayerLive - image de la question', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    savePlayerSession({ pin: '1234', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  const reading = {
    prompt: 'Quel est cet animal ?',
    index: 0,
    total: 3,
    readingTime: 6,
    startedAt: Date.now(),
    media: 'https://ok.example/manchot.png',
    mediaAlt: 'Un manchot',
  }
  const show = {
    id: 'q1',
    type: 'mcq',
    prompt: 'Quel est cet animal ?',
    timeLimit: 20,
    payload: { options: [{ label: 'Manchot' }, { label: 'Pingouin' }, { label: 'Otarie' }, { label: 'Phoque' }] },
    media: 'https://ok.example/manchot.png',
    mediaAlt: 'Un manchot',
  }

  it("affiche l'image pendant la question, pas pendant la lecture", async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('question:reading', reading)
    await screen.findByText('Prépare-toi…')
    expect(screen.queryByRole('img')).toBeNull()

    emitServerEvent('question:show', show)
    await screen.findByText('Manchot')
    expect(screen.getByRole('img', { name: 'Un manchot' })).toBeInTheDocument()
  })

  it("image en échec : l'énoncé et les boutons de réponse restent affichés", async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('question:show', show)
    fireEvent.error(await screen.findByRole('img', { name: 'Un manchot' }))

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Quel est cet animal ?')).toBeInTheDocument()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: /Manchot/ })).toBeEnabled()
  })

  it('question:show sans media (flux ancien) : aucun img, pas d’erreur', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('question:show', { ...show, media: undefined, mediaAlt: undefined })
    await screen.findByText('Manchot')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
