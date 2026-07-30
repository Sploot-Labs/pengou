import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Sql } from 'postgres'
import { createDb, createAppDb, deriveAppUrl, type Db } from './client.js'
import { ensureAppRole, setAppRolePassword } from './role-provisioning.js'

const APP_ROLE = 'app_role'
const APP_PW = 'test-app-pw'

export async function startTestDb(): Promise<{
  db: Db
  client: Sql
  /** Handle du rôle applicatif restreint (soumis au RLS). Utilisable APRÈS `runMigrations`
   * (qui pose les GRANTs). Sans contexte `withTenantTx`, toute requête sur une table de
   * contenu lève (RLS fail-loud). */
  appDb: Db
  appClient: Sql
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

  // Provisionne le rôle applicatif restreint + son mot de passe (via la connexion privilégiée),
  // puis construit le handle `appDb`. Les GRANTs/policies viennent quand le test appelle
  // `runMigrations` (le CREATE ROLE de la migration est idempotent, le rôle existe déjà ici).
  await ensureAppRole(client, APP_ROLE)
  await setAppRolePassword(client, APP_ROLE, APP_PW)
  const appUrl = deriveAppUrl(url, { user: APP_ROLE, password: APP_PW })
  const { db: appDb, client: appClient } = createAppDb(appUrl)

  return {
    db,
    client,
    appDb,
    appClient,
    url,
    container,
    async stop() {
      await appClient.end({ timeout: 5 })
      await client.end({ timeout: 5 })
      await container.stop()
    },
  }
}
