import { describe, expect, it } from 'vitest'
import { boardEntries } from './board'

const ranking = [
  { playerId: 'a', nickname: 'Ana', score: 900 },
  { playerId: 'x', nickname: 'Exclu', score: 500 },
]

describe('boardEntries', () => {
  it('retire les entrées absentes de la liste des joueurs et complète avec les présents non classés', () => {
    const players = [
      { id: 'a', nickname: 'Ana', score: 900 },
      { id: 'c', nickname: 'Carl', score: 0 },
    ]
    expect(boardEntries(ranking, players)).toEqual([
      { playerId: 'a', nickname: 'Ana', score: 900 },
      { playerId: 'c', nickname: 'Carl', score: 0 },
    ])
  })

  it('liste vide si aucun joueur présent', () => {
    expect(boardEntries(ranking, [])).toEqual([])
  })
})
