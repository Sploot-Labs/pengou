import { describe, expect, it } from 'vitest'
import { demoDailyCsv } from './demo-daily-csv.js'

describe('demoDailyCsv', () => {
  it('écrit une ligne par jour et par provenance, sous un en-tête en français', () => {
    const csv = demoDailyCsv([
      { day: '2026-11-14', source: 'enseignants', launched: 3, started: 2 },
      { day: '2026-11-13', source: 'direct', launched: 1, started: 0 },
    ])
    expect(csv.trim().split(/\r?\n/)).toEqual([
      'jour,provenance,lancees,demarrees',
      '2026-11-14,enseignants,3,2',
      '2026-11-13,direct,1,0',
    ])
  })

  it("n'écrit que l'en-tête quand rien n'a été lancé", () => {
    expect(demoDailyCsv([]).trim()).toBe('jour,provenance,lancees,demarrees')
  })
})
