import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { fromNodeHeaders } from 'better-auth/node'
import { schema, type Db } from '@splootlabs/db'
import { TERMS_ACCEPTANCE_REQUIRED, type Auth } from '@splootlabs/auth'
import type { LegalConfig } from '@splootlabs/shared'

export { TERMS_ACCEPTANCE_REQUIRED }

/** Vrai si l'hôte doit (re)valider les CGU : fonction active et version acceptée différente de la
 * courante (null compris, pour un compte antérieur ou créé par un fournisseur tiers). */
export function termsAcceptanceRequired(
  user: { termsVersion?: string | null },
  currentVersion: string | null | undefined,
): boolean {
  if (!currentVersion) return false
  return user.termsVersion !== currentVersion
}

/** Corps de la réponse 403 des routes protégées tant que la version courante n'est pas acceptée. */
export const TERMS_REQUIRED_BODY = {
  error: "Les conditions d'utilisation ont changé. Acceptez-les pour continuer.",
  code: TERMS_ACCEPTANCE_REQUIRED,
} as const

/**
 * Routes des CGU, toutes deux hors `requireUser` (elles doivent rester ouvertes pendant la
 * revalidation) :
 *  - `GET /api/legal` (public) : version et liens de l'instance, `null` partout si la fonction est
 *    désactivée. Lu par l'inscription et l'écran de revalidation.
 *  - `POST /api/legal/accept` (session requise) : enregistre la version courante avec l'heure du
 *    serveur. Le client renvoie la version qu'il a affichée ; une autre version que la courante
 *    (CGU changées pendant la lecture) est refusée en 409 pour qu'il recharge le texte.
 */
export function registerLegal(
  app: FastifyInstance,
  deps: { db: Db; auth: Auth; legal: LegalConfig | null },
): void {
  const { db, auth, legal } = deps

  app.get('/api/legal', async () => ({
    termsVersion: legal?.termsVersion ?? null,
    termsUrl: legal?.termsUrl ?? null,
    privacyUrl: legal?.privacyUrl ?? null,
  }))

  app.post<{ Body: { version?: unknown } | null }>('/api/legal/accept', async (request, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session?.user) return reply.code(401).send({ error: 'Non authentifié.' })
    if (!legal) {
      return reply.code(404).send({ error: "Aucune condition d'utilisation à accepter sur cette instance." })
    }
    if (request.body?.version !== legal.termsVersion) {
      return reply.code(409).send({
        error: "Les conditions d'utilisation ont encore changé. Rechargez la page pour lire la dernière version.",
        code: 'TERMS_VERSION_MISMATCH',
      })
    }
    // Horodatage du serveur : toute date envoyée par le client est ignorée.
    const termsAcceptedAt = new Date()
    await db
      .update(schema.user)
      .set({ termsVersion: legal.termsVersion, termsAcceptedAt })
      .where(eq(schema.user.id, session.user.id))
    return { termsVersion: legal.termsVersion, termsAcceptedAt: termsAcceptedAt.toISOString() }
  })
}
