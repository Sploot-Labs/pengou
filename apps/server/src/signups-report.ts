import { loadConfig } from '@splootlabs/shared'
import { countSignupsBySourceAndWeek, createDb } from '@splootlabs/db'
import { toCsv } from './csv.js'

/**
 * Export CSV des inscriptions par semaine et par provenance (`?from=` des liens du site vitrine),
 * sur la sortie standard. Lecture seule, agrégats seulement.
 *
 *   pnpm --filter @splootlabs/server inscriptions:provenance > inscriptions.csv   # après build
 *   docker compose exec app node apps/server/dist/signups-report.js > inscriptions.csv
 */
const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)
try {
  const rows = await countSignupsBySourceAndWeek(db)
  process.stdout.write(
    toCsv([
      ['semaine', 'provenance', 'inscriptions'],
      ...rows.map((row) => [row.week, row.source ?? '(aucune)', row.signups]),
    ]),
  )
} finally {
  await client.end({ timeout: 5 })
}
