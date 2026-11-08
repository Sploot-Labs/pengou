import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, type Db } from '@splootlabs/db'

export const QUIZ_LIMIT_CODE = 'email_unverified_quiz_limit'

const QUIZ_LIMIT_MESSAGE = "Confirmez votre adresse e-mail pour créer d'autres quiz."

type QuotaOpts = { mailEnabled: boolean; tenancyMode: 'single' | 'multi' }

/** La limite vise l'inscription ouverte : envoi d'e-mails actif, mode multi, adresse non confirmée. */
export function quizQuotaApplies(opts: QuotaOpts & { emailVerified: boolean }): boolean {
  return opts.mailEnabled && opts.tenancyMode === 'multi' && !opts.emailVerified
}

/** Renvoie la réponse de refus (403) si l'utilisateur ne peut pas posséder un quiz de plus, sinon `null`.
 * Comptage sur `systemDb` (hors RLS) : quiz non archivés de l'utilisateur, tous espaces confondus. */
export async function assertCanOwnAnotherQuiz(
  systemDb: Db,
  user: { id: string; emailVerified: boolean },
  opts: QuotaOpts,
): Promise<null | { status: 403; body: { error: string; code: typeof QUIZ_LIMIT_CODE } }> {
  if (!quizQuotaApplies({ ...opts, emailVerified: user.emailVerified })) return null
  const [row] = await systemDb
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.quiz)
    .where(and(eq(schema.quiz.ownerId, user.id), isNull(schema.quiz.archivedAt)))
  if ((row?.n ?? 0) < 1) return null
  return { status: 403, body: { error: QUIZ_LIMIT_MESSAGE, code: QUIZ_LIMIT_CODE } }
}
