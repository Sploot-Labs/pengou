import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createDb, type Db } from './client.js'
import type { Sql } from 'postgres'

export async function startTestDb(): Promise<{
  db: Db
  client: Sql
  url: string
  container: StartedPostgreSqlContainer
  stop: () => Promise<void>
}> {
  // Import dynamique : `@testcontainers/postgresql` est une devDependency (outillage de test),
  // absente de l'image de production (`pnpm install --prod`). `startTestDb` est réexporté depuis
  // le barrel `@splootlabs/db` (utilisé par de nombreux tests), donc un `import` statique en tête
  // de fichier serait évalué dès le chargement du module — y compris par le serveur en production,
  // qui importe `@splootlabs/db` pour `createDb`/`runMigrations` sans jamais appeler `startTestDb`.
  // Le report en dynamique évite un crash `ERR_MODULE_NOT_FOUND` au démarrage en prod.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  const container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  const { db, client } = createDb(url)
  return {
    db,
    client,
    url,
    container,
    async stop() {
      await client.end({ timeout: 5 })
      await container.stop()
    },
  }
}
