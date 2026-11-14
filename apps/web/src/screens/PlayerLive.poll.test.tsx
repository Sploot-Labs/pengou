// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'
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
let reconnectGate: Promise<unknown> | null = null
const mockEmitAck = vi.fn(async (event: string, _payload?: unknown) => {
  if (event === 'player:reconnect') {
    if (reconnectGate) await reconnectGate
    return { playerId: 'p1', phase: 'lobby', score: 0 }
  }
  if (event === 'player:answer') return nextAnswerAck()
  return {}
})

type Ack = { accepted: boolean; reason?: string; code?: string; words?: string[] }
let answerAcks: Ack[] = []
function nextAnswerAck(): Ack {
  return answerAcks.shift() ?? { accepted: false, reason: 'hors phase question' }
}

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

describe('PlayerLive sondage', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    answerAcks = []
    reconnectGate = null
    savePlayerSession({ pin: '1234', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  function showPoll(multiple: boolean, alreadyAnswered?: boolean) {
    emitServerEvent('question:show', {
      id: 'q1',
      type: 'poll',
      prompt: 'Tu aimes la banquise ?',
      timeLimit: 30,
      payload: { options: [{ label: 'Oui' }, { label: 'Non' }, { label: 'Bof' }], multiple },
      ...(alreadyAnswered ? { alreadyAnswered } : {}),
    })
  }

  async function start(multiple: boolean) {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    showPoll(multiple)
    await screen.findByText('Tu aimes la banquise ?')
  }

  it('choix unique : un appui envoie les indices et affiche Vote enregistré', async () => {
    await start(false)
    expect(screen.getByText('Le premier appui valide ta réponse.')).toBeInTheDocument()
    answerAcks.push({ accepted: true })
    fireEvent.click(screen.getByRole('button', { name: /Oui/ }))
    expect(await screen.findByText('Vote enregistré')).toBeInTheDocument()
    expect(mockEmitAck).toHaveBeenCalledWith('player:answer', { answer: { optionIndexes: [0] } })
    expect(screen.getByRole('button', { name: /Non/ })).toBeDisabled()
  })

  it('choix multiple : Valider désactivé puis un seul envoi trié', async () => {
    await start(true)
    expect(screen.getByText('Plusieurs réponses possibles')).toBeInTheDocument()
    const validate = screen.getByRole('button', { name: 'Valider' })
    expect(validate).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Bof/ }))
    fireEvent.click(screen.getByRole('button', { name: /Oui/ }))
    expect(screen.getByRole('button', { name: /Oui/ })).toHaveAttribute('aria-pressed', 'true')
    expect(validate).toBeEnabled()
    answerAcks.push({ accepted: true })
    fireEvent.click(validate)
    expect(await screen.findByText('Vote enregistré')).toBeInTheDocument()
    const sent = mockEmitAck.mock.calls.filter(([event]) => event === 'player:answer')
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toEqual({ answer: { optionIndexes: [0, 2] } })
  })

  it('un refus rouvre le sondage', async () => {
    await start(false)
    answerAcks.push({ accepted: false, reason: 'réponse invalide pour ce type de question', code: 'INVALID_ANSWER' })
    fireEvent.click(screen.getByRole('button', { name: /Oui/ }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /Non/ })).toBeEnabled()
    expect(screen.queryByText('Vote enregistré')).toBeNull()
  })

  it('un refus INVALID_ANSWER en anglais rouvre aussi le sondage', async () => {
    setLang('en')
    try {
      await start(false)
      answerAcks.push({ accepted: false, reason: 'invalid answer for this question type', code: 'INVALID_ANSWER' })
      fireEvent.click(screen.getByRole('button', { name: /Oui/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Your answer wasn't counted: invalid answer for this question type",
      )
      expect(screen.getByRole('button', { name: /Non/ })).toBeEnabled()
    } finally {
      setLang('fr')
    }
  })

  it('un autre refus garde le sondage verrouillé', async () => {
    await start(false)
    answerAcks.push({ accepted: false, reason: 'hors phase question' })
    fireEvent.click(screen.getByRole('button', { name: /Oui/ }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /Non/ })).toBeDisabled()
  })

  it('question:reveal affiche Sondage clos sans répartition ni verdict', async () => {
    await start(false)
    answerAcks.push({ accepted: true })
    fireEvent.click(screen.getByRole('button', { name: /Oui/ }))
    await screen.findByText('Vote enregistré')
    emitServerEvent('question:reveal', {
      correct: null,
      distribution: {},
      poll: { votes: [3, 1, 0], voters: 4 },
    })
    expect(await screen.findByText('Sondage clos')).toBeInTheDocument()
    expect(screen.getByText("Regarde l'écran pour voir les résultats.")).toBeInTheDocument()
    expect(screen.queryByText(/%/)).toBeNull()
    expect(screen.queryByText('Oui')).toBeNull()
    expect(screen.queryByText(/Juste|Raté|Temps écoulé|pts|Résultat indisponible/)).toBeNull()
  })

  it('reconnexion après un vote : Vote enregistré sans tuile active', async () => {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    showPoll(false, true)
    expect(await screen.findByText('Vote enregistré')).toBeInTheDocument()
    for (const name of [/Oui/, /Non/, /Bof/]) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it("question:show avec alreadyAnswered arrivant avant la fin de l'acquittement verrouille, sans contaminer le sondage suivant", async () => {
    let release: (v: unknown) => void = () => {}
    reconnectGate = new Promise((resolve) => {
      release = resolve
    })
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    showPoll(false, true)
    expect(await screen.findByText('Vote enregistré')).toBeInTheDocument()
    await act(async () => {
      release(null)
    })
    emitServerEvent('question:show', {
      id: 'q2',
      type: 'poll',
      prompt: 'Autre sondage ?',
      timeLimit: 30,
      payload: { options: [{ label: 'A' }, { label: 'B' }], multiple: false },
    })
    await screen.findByText('Autre sondage ?')
    expect(screen.getByRole('button', { name: /^A/ })).toBeEnabled()
    expect(screen.queryByText('Vote enregistré')).toBeNull()
  })

  it('sans reconnexion avec réponse, un sondage suivant est votable', async () => {
    await start(false)
    expect(screen.getByRole('button', { name: /Oui/ })).toBeEnabled()
  })
})

describe('PlayerLive, fin de partie sans question notée', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
    answerAcks = []
    reconnectGate = null
    savePlayerSession({ pin: '1234', playerId: 'p1', joinToken: 'tok1', nickname: 'Ana' })
  })
  afterEach(() => {
    cleanup()
    clearPlayerSession()
  })

  async function start() {
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
  }

  it('hasScoredQuestions faux : « Merci pour tes réponses », ni score ni rang', async () => {
    await start()
    emitServerEvent('podium', { top: [], sources: [], hasScoredQuestions: false })
    expect(await screen.findByRole('heading', { name: 'Merci pour tes réponses' })).toBeInTheDocument()
    expect(screen.queryByText(/Score final/)).toBeNull()
    expect(screen.queryByText('Partie terminée !')).toBeNull()
  })

  it('hasScoredQuestions vrai avec un score à 0 : « Partie terminée ! » et le score', async () => {
    await start()
    emitServerEvent('podium', { top: [], sources: [], hasScoredQuestions: true })
    expect(await screen.findByText('Partie terminée !')).toBeInTheDocument()
    expect(screen.getByText(/Score final/)).toBeInTheDocument()
  })
})
