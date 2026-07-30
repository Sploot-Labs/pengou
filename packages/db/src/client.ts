import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema.js'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(databaseUrl: string): { db: Db; client: Sql } {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, client }
}

/** Handle du rôle applicatif restreint (soumis au RLS). Identique à `createDb` ; nom explicite
 * pour distinguer clairement `appDb` (GUC par transaction) de `systemDb` (privilégié, bypass). */
export function createAppDb(databaseUrl: string): { db: Db; client: Sql } {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, client }
}

/** Dérive une chaîne de connexion pour un autre rôle (mêmes host/port/db). Sert à construire
 * l'URL `appDb` (rôle `app_role`) à partir de la `DATABASE_URL` privilégiée, sans exiger une
 * seconde URL en self-host. */
export function deriveAppUrl(databaseUrl: string, opts: { user: string; password: string }): string {
  const u = new URL(databaseUrl)
  u.username = opts.user
  u.password = opts.password
  return u.toString()
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
