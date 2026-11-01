// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { clearPlayerSession, savePlayerSession } from '../realtime/playerSession'
import { PlayerLive } from './PlayerLive'

/**
 * Câblage « Arcade polaire » (données réelles) : compteur du lobby via
 * `lobby:count`, « n / N » via les champs positionnels de `question:show`, et
 * série de bonnes réponses calculée côté client sur les verdicts successifs.
 * Même stratégie de mock socket que `PlayerLive.reading.test.tsx`, mais
 * `player:answer` répond `{accepted:true}` pour pouvoir atteindre le verdict.
 */

// Les cues de résultat (son + Web Animations API) ne sont pas disponibles sous
// jsdom et ne font pas l'objet de ces tests (on valide la logique du verdict et
// de la série). On neutralise `useCue`/`useSound` tout en gardant le vrai
// `MotionProvider` pour le reste de l'arbre.
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

/** Options mcq : A (bonne réponse) puis B. */
const MCQ_SHOW = {
  id: 'q1',
  type: 'mcq' as const,
  prompt: 'Quel manchot est le plus grand ?',
  timeLimit: 20,
  index: 2,
  total: 10,
  payload: { options: [{ label: 'Empereur' }, { label: 'Adélie' }] },
}
const MCQ_REVEAL = {
  correct: { options: [{ label: 'Empereur', correct: true }, { label: 'Adélie', correct: false }] },
  distribution: {},
}

/** Joue une manche mcq complète en choisissant la bonne réponse. `index` pose
 * le numéro de question (0-basé) du show. Laisse l'écran en phase verdict. */
async function playCorrectRound(index: number, score: number) {
  emitServerEvent('question:show', { ...MCQ_SHOW, index })
  const tile = await screen.findByRole('button', { name: /Empereur/ })
  fireEvent.click(tile)
  // La réponse est verrouillée (phase 'answered') puis acceptée par le serveur.
  await waitFor(() =>
    expect(mockEmitAck).toHaveBeenCalledWith('player:answer', { answer: { optionIndex: 0 } }),
  )
  await screen.findByText(/Réponse enregistrée/)
  emitServerEvent('question:reveal', MCQ_REVEAL)
  emitServerEvent('scoreboard', { ranking: [{ playerId: 'p1', nickname: 'Ana', score }] })
  await screen.findByText('Juste !')
}

describe('PlayerLive — arcade polaire (données réelles)', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    savePlayerSession({ pin: '482913', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  it('lobby : affiche le compteur « manchots sur la glace » depuis lobby:count', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    // Aucun nombre inventé tant que le compteur n'est pas arrivé.
    expect(screen.queryByText(/sur la glace/)).toBeNull()

    emitServerEvent('lobby:count', { count: 3 })

    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByText('manchots sur la glace')).toBeInTheDocument()
  })

  it('question : affiche « n / N » depuis les champs positionnels de question:show', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    emitServerEvent('question:show', { ...MCQ_SHOW, index: 2, total: 10 })

    // index 2 (0-basé) → « 3 / 10 » dans l'en-tête de question.
    await screen.findByText('Empereur')
    const qnum = document.querySelector('.player-qnum')
    expect(qnum?.textContent?.replace(/\s+/g, ' ').trim()).toBe('3 / 10')
  })

  it('verdict : une bonne réponse affiche « Juste ! » et les points', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    await playCorrectRound(2, 850)

    expect(screen.getByText('Juste !')).toBeInTheDocument()
    expect(screen.getByText(/\+850/)).toBeInTheDocument()
  })

  it('série : deux bonnes réponses d’affilée affichent « Série de 2 »', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))

    // Manche 1 : pas encore de chip (série = 1).
    await playCorrectRound(0, 850)
    expect(screen.queryByText(/Série de/)).toBeNull()

    // Manche 2 : nouvelle lecture puis question, seconde bonne réponse.
    emitServerEvent('question:reading', {
      prompt: 'Préparation…',
      index: 1,
      total: 10,
      readingTime: 3,
      startedAt: Date.now(),
    })
    await playCorrectRound(1, 1700)

    expect(await screen.findByText('Série de 2')).toBeInTheDocument()
  })
})
