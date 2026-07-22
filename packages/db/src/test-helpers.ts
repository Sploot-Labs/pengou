import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createDb, type Db } from './client.js'
import type { Sql } from 'postgres'

export async function startTestDb(): Promise<{
  db: Db
  client: Sql
  url: string
  container: StartedPostgreSqlContainer
  stop: () => Promise<void>
}> {
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
