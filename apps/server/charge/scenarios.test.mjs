import { describe, expect, it } from 'vitest'
import { SCENARIOS } from './scenarios.mjs'

describe('scénarios de campagne', () => {
  it('le scénario « demo » joue vingt parties de 30 joueurs, le plafond de la démonstration', () => {
    expect(SCENARIOS.demo).toEqual([{ libelle: 'demo', joueurs: 30, parties: 20, cadence: 25, essais: 1 }])
  })

  it('chaque passage de chaque scénario est complet', () => {
    for (const [nom, passages] of Object.entries(SCENARIOS)) {
      expect(passages.length, nom).toBeGreaterThan(0)
      for (const passage of passages) {
        expect(typeof passage.libelle, nom).toBe('string')
        for (const cle of ['joueurs', 'parties', 'cadence', 'essais']) {
          expect(Number.isInteger(passage[cle]) && passage[cle] > 0, `${nom}.${passage.libelle}.${cle}`).toBe(true)
        }
      }
    }
  })
})
