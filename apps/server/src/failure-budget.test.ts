import { describe, it, expect } from 'vitest'
import { FailureBudget } from './failure-budget.js'

function clock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('FailureBudget', () => {
  it('bloque après max échecs dans la fenêtre puis se rouvre', () => {
    const c = clock()
    const budget = new FailureBudget({ max: 30, windowMs: 5 * 60_000, now: c.now })
    for (let i = 0; i < 29; i++) budget.recordFailure('A')
    expect(budget.isBlocked('A')).toBe(false)
    budget.recordFailure('A')
    expect(budget.isBlocked('A')).toBe(true)
    c.advance(5 * 60_000 - 1)
    expect(budget.isBlocked('A')).toBe(true)
    c.advance(1)
    expect(budget.isBlocked('A')).toBe(false)
    // Nouvelle fenêtre : le compteur repart de zéro.
    budget.recordFailure('A')
    expect(budget.isBlocked('A')).toBe(false)
  })

  it('isole les clés', () => {
    const c = clock()
    const budget = new FailureBudget({ max: 30, windowMs: 5 * 60_000, now: c.now })
    for (let i = 0; i < 30; i++) budget.recordFailure('A')
    expect(budget.isBlocked('A')).toBe(true)
    expect(budget.isBlocked('B')).toBe(false)
  })

  it('évince la clé la plus ancienne quand maxKeys est atteint', () => {
    const c = clock()
    const budget = new FailureBudget({ max: 2, windowMs: 60_000, now: c.now, maxKeys: 2 })
    budget.recordFailure('A')
    budget.recordFailure('A')
    c.advance(1)
    budget.recordFailure('B')
    budget.recordFailure('B')
    c.advance(1)
    budget.recordFailure('C')
    budget.recordFailure('C')
    expect(budget.isBlocked('A')).toBe(false)
    expect(budget.isBlocked('B')).toBe(true)
    expect(budget.isBlocked('C')).toBe(true)
  })

  it('purge les clés expirées au fil des accès', () => {
    const c = clock()
    const budget = new FailureBudget({ max: 1, windowMs: 60_000, now: c.now, maxKeys: 2 })
    budget.recordFailure('A')
    budget.recordFailure('B')
    c.advance(60_000)
    // A et B ont expiré : C et D tiennent sans évincer une clé encore active.
    budget.recordFailure('C')
    budget.recordFailure('D')
    expect(budget.isBlocked('C')).toBe(true)
    expect(budget.isBlocked('D')).toBe(true)
    expect(budget.size).toBe(2)
  })
})
