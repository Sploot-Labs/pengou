import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema.js'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(databaseUrl: string): { db: Db; client: Sql } {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, client }
}
