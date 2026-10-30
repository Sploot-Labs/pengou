// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PodiumView } from './Podium'

describe('PodiumView', () => {
  afterEach(cleanup)

  it("n'affiche aucun joueur deux fois quand le classement complet diverge du podium", () => {
    // Classement complet en retard sur le podium : Zoe y est 3e, Cleo, montée sur le podium,
    // y est encore 4e. Un `slice(3)` répéterait Cleo dans le classement complet.
    const top = [
      { playerId: 'p1', nickname: 'Ana', score: 500 },
      { playerId: 'p2', nickname: 'Bob', score: 400 },
      { playerId: 'p3', nickname: 'Cleo', score: 300 },
    ]
    const fullRanking = [
      { playerId: 'p1', nickname: 'Ana', score: 500 },
      { playerId: 'p2', nickname: 'Bob', score: 400 },
      { playerId: 'p-zoe', nickname: 'Zoe', score: 350 },
      { playerId: 'p3', nickname: 'Cleo', score: 300 },
      { playerId: 'p4', nickname: 'Dan', score: 200 },
    ]
    const { container } = render(<PodiumView top={top} fullRanking={fullRanking} />)
    for (const name of ['Ana', 'Bob', 'Cleo', 'Dan']) {
      expect(screen.getAllByText(name)).toHaveLength(1)
    }
    const rest = within(screen.getByRole('region', { name: 'Classement complet' }))
    expect(rest.queryByText('Cleo')).toBeNull()
    expect(Array.from(container.querySelectorAll('.podium-list__rank')).map((n) => n.textContent)).toEqual(['4', '5'])
  })
})
