import { desc, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { user } from '../auth-schema.js'

export type SignupsBySourceRow = {
  /** Lundi de la semaine (AAAA-MM-JJ, semaine ISO). */
  week: string
  /** Provenance `?from=` de l'inscription ; null : inscription directe ou sans provenance. */
  source: string | null
  signups: number
}

/**
 * Nombre d'inscriptions par semaine et par provenance (`user.signup_source`), de la semaine la plus
 * récente à la plus ancienne. Agrégat seul : aucune donnée de compte n'en sort.
 */
export async function countSignupsBySourceAndWeek(db: Db): Promise<SignupsBySourceRow[]> {
  const week = sql<string>`to_char(date_trunc('week', ${user.createdAt}), 'YYYY-MM-DD')`
  const signups = sql<number>`count(*)::int`
  return db
    .select({ week, source: user.signupSource, signups })
    .from(user)
    .groupBy(week, user.signupSource)
    .orderBy(desc(week), desc(signups), user.signupSource)
}
