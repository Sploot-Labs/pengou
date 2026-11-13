import type { DemoDailyRow } from '@splootlabs/db'
import { toCsv } from './csv.js'

/** CSV du compteur quotidien des parties de démonstration : agrégats seuls, aucune donnée de compte. */
export function demoDailyCsv(rows: DemoDailyRow[]): string {
  return toCsv([
    ['jour', 'provenance', 'lancees', 'demarrees'],
    ...rows.map((row) => [row.day, row.source, row.launched, row.started]),
  ])
}
