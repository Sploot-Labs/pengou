import { loadConfig } from '@splootlabs/shared'
import { createDb, runMigrations } from '@splootlabs/db'

/**
 * Étape de migration DÉDIÉE (P1-9), séparée du démarrage du serveur. À lancer AVANT de démarrer
 * les répliques en déploiement multi-instance (avec `MIGRATE_ON_BOOT=false`) — évite N migrations
 * concurrentes au boot. En mono-instance/self-host, la migration au boot suffit ; ce script reste
 * utile pour appliquer le schéma sans démarrer le serveur (CI, job de release).
 *
 *   pnpm --filter @splootlabs/server migrate   # après build
 */
const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)
try {
  await runMigrations(db)
  // eslint-disable-next-line no-console -- point d'entrée CLI : sortie standard attendue.
  console.log('Migrations appliquées.')
} finally {
  await client.end({ timeout: 5 })
}
