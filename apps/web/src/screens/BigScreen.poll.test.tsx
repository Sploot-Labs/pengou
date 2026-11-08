// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

/** Délai de maintien de la révélation dans BigScreen (REVEAL_HOLD_MS), avec une marge. */
const PAST_REVEAL_HOLD_MS = 5000 + 500

const pollQuestion = {
  id: 'p1',
  type: 'poll',
  prompt: 'Boisson préférée ?',
  timeLimit: 20,
  payload: { options: [{ label: 'Café' }, { label: 'Thé' }, { label: 'Chocolat' }], multiple: true },
}

function pollReveal(over: Record<string, unknown> = {}) {
  return {
    correct: null,
    distribution: {},
    poll: {
      questionId: 'p1',
      multiple: true,
      voters: 3,
      options: [
        { label: 'Café', votes: 2 },
        { label: 'Thé', votes: 1 },
        { label: 'Chocolat', votes: 3 },
      ],
      ...over,
    },
  }
}

const ranking = { ranking: [{ playerId: 'a', nickname: 'Alice', score: 0 }] }

describe('BigScreen, sondage', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  async function joined() {
    renderBigScreen()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))
  }

  async function showQuestion(q: { prompt: string; [k: string]: unknown }) {
    emitServerEvent('question:show', q)
    await screen.findByText(q.prompt)
  }

  /** Écoule REVEAL_HOLD_MS sur le minuteur simulé, puis laisse une éventuelle transition de phase
   * (animée hors de ce minuteur) aller à son terme avant les assertions. */
  async function holdElapsed() {
    act(() => {
      vi.advanceTimersByTime(PAST_REVEAL_HOLD_MS)
    })
    vi.useRealTimers()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
    })
  }

  it('pendant la question, affiche les choix, le compteur et la mention du choix multiple', async () => {
    await joined()
    await showQuestion(pollQuestion)
    expect(screen.getByText('Café')).toBeInTheDocument()
    expect(screen.getByText('Chocolat')).toBeInTheDocument()
    expect(screen.getByText(/répondu/)).toBeInTheDocument()
    expect(screen.getByText('Plusieurs réponses possibles')).toBeInTheDocument()
  })

  it("n'affiche pas la mention du choix multiple pour un sondage à choix unique", async () => {
    await joined()
    await showQuestion({ ...pollQuestion, payload: { ...pollQuestion.payload, multiple: false } })
    expect(screen.queryByText('Plusieurs réponses possibles')).toBeNull()
  })

  it('à la clôture, affiche chaque choix, ses votes et son pourcentage, sans bonne réponse', async () => {
    await joined()
    await showQuestion(pollQuestion)
    emitServerEvent('question:reveal', pollReveal())
    expect(await screen.findByText('67 %')).toBeInTheDocument()
    expect(screen.getByText('Café')).toBeInTheDocument()
    expect(screen.getByText('Thé')).toBeInTheDocument()
    expect(screen.getByText('Chocolat')).toBeInTheDocument()
    // Le normaliseur de Testing Library ramène l'espace insécable à une espace : on vérifie le
    // texte brut pour garantir l'insécable avant « % ».
    expect(screen.getByText('67 %').textContent).toBe('67\u00a0%')
    expect(screen.getByText('33 %').textContent).toBe('33\u00a0%')
    expect(screen.getByText('100 %').textContent).toBe('100\u00a0%')
    expect(screen.getByText('2 votes')).toBeInTheDocument()
    expect(screen.getByText('1 vote')).toBeInTheDocument()
    expect(screen.queryByText(/bonne réponse/)).toBeNull()
    expect(document.querySelector('.big-distribution__col--correct')).toBeNull()
  })

  it('sans aucun votant, affiche « Aucun vote » à la place des barres', async () => {
    await joined()
    await showQuestion(pollQuestion)
    emitServerEvent(
      'question:reveal',
      pollReveal({ voters: 0, options: pollQuestion.payload.options.map((o) => ({ label: o.label, votes: 0 })) }),
    )
    expect(await screen.findByText('Aucun vote')).toBeInTheDocument()
    expect(document.querySelector('.big-distribution')).toBeNull()
    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it('reste sur la répartition après un scoreboard et le délai de maintien écoulé', async () => {
    await joined()
    await showQuestion(pollQuestion)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    emitServerEvent('question:reveal', pollReveal())
    emitServerEvent('scoreboard', ranking)
    await holdElapsed()
    expect(screen.getByText('67 %')).toBeInTheDocument()
    expect(screen.queryByText('Classement')).toBeNull()
    expect(screen.queryByText('Alice')).toBeNull()
  })

  it('un nuage de mots reste lui aussi sur la révélation', async () => {
    await joined()
    await showQuestion({ id: 'w1', type: 'wordcloud', prompt: 'Un mot ?', timeLimit: 30, payload: {} })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    emitServerEvent('question:reveal', { correct: null, distribution: {} })
    emitServerEvent('scoreboard', ranking)
    await holdElapsed()
    expect(screen.getByText('Un mot ?')).toBeInTheDocument()
    expect(screen.queryByText('Classement')).toBeNull()
  })

  it("affiche le compte à rebours d'enchaînement automatique sous la répartition", async () => {
    await joined()
    await showQuestion(pollQuestion)
    emitServerEvent('question:reveal', pollReveal())
    await screen.findByText('2 votes')
    expect(document.querySelector('.big-auto-countdown')).toBeNull()
    emitServerEvent('auto:advance', { nextAt: Date.now() + 8000 })
    const countdown = await screen.findByText(/Question suivante dans \d+ s/)
    expect(countdown).toHaveClass('big-auto-countdown')
    expect(screen.getByText('Café')).toBeInTheDocument()
  })

  it("un QCM n'affiche pas le compte à rebours sur la révélation, seulement sur le classement", async () => {
    await joined()
    await showQuestion({
      id: 'q4',
      type: 'mcq',
      prompt: 'Fleuve ?',
      timeLimit: 20,
      payload: { options: [{ label: 'Loire' }, { label: 'Rhône' }] },
    })
    emitServerEvent('question:reveal', {
      correct: {
        options: [
          { label: 'Loire', correct: true },
          { label: 'Rhône', correct: false },
        ],
      },
      distribution: {},
    })
    emitServerEvent('auto:advance', { nextAt: Date.now() + 8000 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    expect(screen.queryByText(/Question suivante dans/)).toBeNull()
  })

  it('un QCM bascule toujours sur le classement (non-régression)', async () => {
    await joined()
    await showQuestion({
      id: 'q3',
      type: 'mcq',
      prompt: 'Capitale ?',
      timeLimit: 20,
      payload: { options: [{ label: 'Lisbonne' }, { label: 'Madrid' }] },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    emitServerEvent('question:reveal', {
      correct: {
        options: [
          { label: 'Lisbonne', correct: true },
          { label: 'Madrid', correct: false },
        ],
      },
      distribution: {},
    })
    emitServerEvent('lobby:update', {
      players: ranking.ranking.map((r) => ({ id: r.playerId, nickname: r.nickname, score: r.score, connected: true })),
    })
    emitServerEvent('scoreboard', ranking)
    await holdElapsed()
    expect(screen.getByText('Classement')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})

describe('BigScreen, fin de partie sans question notée', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  afterEach(cleanup)

  async function joined() {
    renderBigScreen()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))
  }

  it('hasScoredQuestions faux : « Merci pour vos réponses », sans classement, avec le pied de conversion', async () => {
    await joined()
    emitServerEvent('podium', { top: [], sources: [], hasScoredQuestions: false })
    expect(await screen.findByRole('heading', { name: 'Merci pour vos réponses' })).toBeInTheDocument()
    expect(screen.queryByText('Classement final')).toBeNull()
    expect(screen.getByText(/Créez votre quiz gratuitement/)).toBeInTheDocument()
  })

  it('hasScoredQuestions vrai avec des scores à 0 : le podium reste', async () => {
    await joined()
    emitServerEvent('podium', {
      top: [{ playerId: 'a', nickname: 'Alice', score: 0 }],
      sources: [],
      hasScoredQuestions: true,
    })
    expect(await screen.findByText('Classement final')).toBeInTheDocument()
    expect(screen.queryByText('Merci pour vos réponses')).toBeNull()
  })
})
