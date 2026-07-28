import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema.js'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(databaseUrl: string): { db: Db; client: Sql } {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, client }
}

/** Ping de disponibilité de la base (readiness, P1-10) : `SELECT 1`. `true` si la DB répond,
 * `false` sur toute erreur (connexion perdue, pool saturé…). Ne lève jamais. */
export async function pingDb(client: Sql): Promise<boolean> {
  try {
    await client`select 1`
    return true
  } catch {
    return false
  }
}
