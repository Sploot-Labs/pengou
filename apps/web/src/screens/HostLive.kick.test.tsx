// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function renderHostLive() {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/host/s1', state: { pin: '1234', quizTitle: 'Quiz Test', launch: PAGE_LOAD_ID } }]}
    >
      <Routes>
        <Route path="/host/:sessionId" element={<HostLive />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ana = { id: 'p1', nickname: 'Ana', score: 0, connected: true }
const bob = { id: 'p2', nickname: 'Bob', score: 0, connected: true }

const questionShow = {
  id: 'q1',
  type: 'mcq',
  prompt: 'Quelle est la capitale du Portugal ?',
  timeLimit: 20,
  payload: { options: [{ label: 'Lisbonne' }, { label: 'Madrid' }, { label: 'Porto' }, { label: 'Séville' }] },
}

describe("HostLive, exclusion d'un joueur", () => {
  beforeEach(() => {
    handlers.clear()
    mockEmitAck.mockReset()
    mockEmitAck.mockImplementation(async () => ({}))
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lobby : confirmer « Exclure Ana » émet host:kick { playerId }', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
    expect(window.confirm).toHaveBeenCalledWith('Exclure Ana de la partie ?')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:kick', { playerId: 'p1' }))
  })

  it("annuler la confirmation n'émet rien", async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mockEmitAck).not.toHaveBeenCalledWith('host:kick', expect.anything())
  })

  it('en jeu (première question) : le tableau liste les joueurs présents avec un bouton Exclure', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', questionShow)
    const aside = await screen.findByRole('complementary', { name: 'Dernier classement connu' })
    const topBoard = aside.querySelector('ol.hostlive-board') as HTMLElement
    expect(within(topBoard).getByRole('button', { name: 'Exclure Bob' })).toBeInTheDocument()
    expect(within(topBoard).getByRole('button', { name: 'Exclure Ana' })).toBeInTheDocument()
  })

  it("le joueur exclu disparaît du tableau au lobby:update suivant, même s'il reste dans le dernier scoreboard", async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', questionShow)
    emitServerEvent('scoreboard', {
      ranking: [
        { playerId: 'p1', nickname: 'Ana', score: 800 },
        { playerId: 'p2', nickname: 'Bob', score: 500 },
      ],
    })
    await screen.findAllByRole('button', { name: 'Exclure Bob' })
    emitServerEvent('lobby:update', { players: [ana] })
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Exclure Bob' })).toBeNull()
  })

  it('en jeu avec 10 joueurs : le 10e, hors du top, est excluable depuis « Tous les joueurs (10) »', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i + 1}`,
      nickname: `Joueur${i + 1}`,
      score: 0,
      connected: true,
    }))
    renderHostLive()
    emitServerEvent('lobby:update', { players: ten })
    emitServerEvent('question:show', questionShow)
    const aside = await screen.findByRole('complementary', { name: 'Dernier classement connu' })
    // Le top 5 de l'encart ne montre pas le 10e joueur.
    const topBoard = aside.querySelector('ol.hostlive-board') as HTMLElement
    expect(within(topBoard).queryByText('Joueur10')).toBeNull()
    const summary = within(aside).getByText('Tous les joueurs (10)')
    const details = summary.closest('details') as HTMLElement
    fireEvent.click(summary)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(details).getByRole('button', { name: 'Exclure Joueur10' }))
    expect(window.confirm).toHaveBeenCalledWith('Exclure Joueur10 de la partie ?')
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:kick', { playerId: 'p10' }))
  })

  it('« Tous les joueurs » reste disponible pendant le classement', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', questionShow)
    emitServerEvent('question:reveal', {
      correct: { options: [{ label: 'Lisbonne', correct: true }] },
      distribution: {},
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Afficher le classement' }))
    emitServerEvent('scoreboard', { ranking: [{ playerId: 'p1', nickname: 'Ana', score: 800 }] })
    const aside = await screen.findByRole('complementary', { name: 'Joueurs de la partie' })
    const details = within(aside).getByText('Tous les joueurs (2)').closest('details') as HTMLElement
    expect(within(details).getByRole('button', { name: 'Exclure Bob' })).toBeInTheDocument()
  })

  it('avant le premier classement, le top joueurs ne numérote pas les rangs', async () => {
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana, bob] })
    emitServerEvent('question:show', questionShow)
    const aside = await screen.findByRole('complementary', { name: 'Dernier classement connu' })
    expect(within(aside).getByText('Top joueurs')).toBeInTheDocument()
    expect(within(aside).getAllByText('Bob').length).toBeGreaterThan(0)
    expect(aside.querySelectorAll('.hostlive-board__rank')).toHaveLength(0)

    emitServerEvent('scoreboard', {
      ranking: [
        { playerId: 'p2', nickname: 'Bob', score: 800 },
        { playerId: 'p1', nickname: 'Ana', score: 500 },
      ],
    })
    expect(Array.from(aside.querySelectorAll('.hostlive-board__rank')).map((n) => n.textContent)).toEqual(['1', '2'])
  })

  it("podium : le classement complet suit le ranking du podium, sans l'exclu du dernier scoreboard", async () => {
    const { container } = renderHostLive()
    emitServerEvent('scoreboard', {
      ranking: [
        { playerId: 'p1', nickname: 'Ana', score: 500 },
        { playerId: 'p2', nickname: 'Bob', score: 400 },
        { playerId: 'p3', nickname: 'Cleo', score: 300 },
        { playerId: 'p-zoe', nickname: 'Zoe', score: 250 },
        { playerId: 'p4', nickname: 'Dan', score: 200 },
      ],
    })
    const ranking = [
      { playerId: 'p1', nickname: 'Ana', score: 500 },
      { playerId: 'p2', nickname: 'Bob', score: 400 },
      { playerId: 'p3', nickname: 'Cleo', score: 300 },
      { playerId: 'p4', nickname: 'Dan', score: 200 },
    ]
    emitServerEvent('podium', { top: ranking.slice(0, 3), ranking })
    const full = await screen.findByRole('region', { name: 'Classement complet' })
    expect(within(full).getByText('Dan')).toBeInTheDocument()
    expect(container.textContent).not.toContain('Zoe')
  })

  it("une erreur d'ack est affichée", async () => {
    mockEmitAck.mockImplementation(async (event?: string) => {
      if (event === 'host:kick') throw new Error('exclusion impossible au podium')
      return {}
    })
    renderHostLive()
    emitServerEvent('lobby:update', { players: [ana] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
    expect(await screen.findByText('exclusion impossible au podium')).toBeInTheDocument()
  })
})
