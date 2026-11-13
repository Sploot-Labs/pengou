import { loadConfig } from '@splootlabs/shared'
import { createDb, listDemoDaily } from '@splootlabs/db'
import { demoDailyCsv } from './demo-daily-csv.js'

/**
 * Export CSV du compteur quotidien des parties de démonstration sans compte (par jour UTC et par
 * provenance : démonstrations lancées, parties démarrées avec au moins un joueur), sur la sortie
 * standard. Lecture seule, agrégats seulement.
 *
 *   pnpm --filter @splootlabs/server demos:rapport > demonstrations.csv   # après build
 *   docker compose exec app node apps/server/dist/demo-report.js > demonstrations.csv
 */
const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)
try {
  process.stdout.write(demoDailyCsv(await listDemoDaily(db)))
} finally {
  await client.end({ timeout: 5 })
}
