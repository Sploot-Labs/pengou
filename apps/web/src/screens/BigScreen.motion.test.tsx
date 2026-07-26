// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { BigScreen } from './BigScreen.js'

/**
 * `BigScreen` ouvre sa PROPRE socket (`useGameSocket`, pas la socket partagée
 * hôte — voir le commentaire en tête de BigScreen.tsx) : on mocke ce hook
 * plutôt que de laisser un vrai `socket.io-client` tenter une connexion
 * réseau en test. `mockOn` retient les callbacks par événement pour que les
 * tests puissent rejouer des messages serveur (`question:reading`,
 * `question:show`, …) via `emitServerEvent` ci-dessous.
 */

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

function renderJoinedBigScreen() {
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

describe('BigScreen — habillage motion', () => {
  it('monte la sous-arborescence en thème scene / schéma dark', () => {
    const { container } = render(
      <MotionProvider>
        <MemoryRouter initialEntries={['/screen/s1?token=&pin=1234']}>
          <Routes>
            <Route path="/screen/:sessionId" element={<BigScreen />} />
          </Routes>
        </MemoryRouter>
      </MotionProvider>,
    )
    const scene = container.querySelector('[data-theme="scene"]')
    expect(scene).not.toBeNull()
    expect(scene?.getAttribute('data-scheme')).toBe('dark')
  })
})

describe('BigScreen — phase lecture (question:reading)', () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockClear()
  })
  // Sans ce nettoyage, le heading « joué » d'un test reste dans `document`
  // (aucun cleanup global — voir vitest.setup.ts) et fausse les requêtes
  // `getByText`/`activeElement` du test suivant.
  afterEach(cleanup)

  it('question:reading affiche l’énoncé seul (aucun libellé d’option) avec un décompte textuel, focalisé (RGAA)', async () => {
    renderJoinedBigScreen()

    // Le join (`screen:join`) doit avoir résolu avant que `question:reading`
    // ait un effet visible.
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))

    emitServerEvent('question:reading', {
      prompt: 'Quelle est la capitale du Portugal ?',
      index: 0,
      total: 3,
      readingTime: 6,
      startedAt: Date.now(),
    })

    const heading = await screen.findByText('Quelle est la capitale du Portugal ?')
    expect(heading.tagName).toBe('H1')

    // Décompte textuel toujours présent (RGAA — jamais seulement l'animation
    // du badge décoratif).
    expect(screen.getByText(/Lecture — \d+ s restantes/)).toBeInTheDocument()

    // Anti-triche : aucun libellé d'option ne doit fuiter pendant la lecture
    // (le payload `question:reading` n'en contient d'ailleurs aucun).
    expect(screen.queryByText('Lisbonne')).toBeNull()
    expect(document.querySelector('.big-answers')).toBeNull()

    // Focus RGAA 2.4.3 : le titre de la nouvelle phase reçoit le focus au montage.
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('question:show bascule ensuite vers la phase question avec les options (et sans le décompte de lecture)', async () => {
    renderJoinedBigScreen()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('screen:join', { displayToken: 'tok-abc' }))

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

    // Le badge de phase (contrairement au titre, dont le texte est
    // volontairement identique entre lecture et question — c'est la MÊME
    // question) distingue sans ambiguïté la phase lecture, sortante, de la
    // phase question, entrante : attendre sa disparition avant de re-requêter
    // le titre garantit qu'on n'accroche pas la référence DOM de l'ANCIEN
    // titre (encore monté pendant l'exit ~350ms de PhaseTransition).
    await waitFor(() => expect(screen.queryByText('Lecture en cours')).toBeNull())
    await screen.findByText('Question en cours')

    const heading = screen.getByText('Quelle est la capitale du Portugal ?')
    expect(screen.getByText('Lisbonne')).toBeInTheDocument()
    expect(screen.getByText('Madrid')).toBeInTheDocument()

    // Le décompte de lecture a disparu avec la bascule de phase.
    expect(screen.queryByText(/Lecture — \d+ s restantes/)).toBeNull()

    // Le nouveau titre de phase (même montage React que le titre lecture,
    // mais une phase différente sous PhaseTransition) reste focalisé.
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})
