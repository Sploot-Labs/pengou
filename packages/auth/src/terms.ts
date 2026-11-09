import { APIError } from 'better-auth/api'

/** Code d'erreur commun au refus d'inscription et à la revalidation des CGU (API et client). */
export const TERMS_ACCEPTANCE_REQUIRED = 'TERMS_ACCEPTANCE_REQUIRED'

/** Chemin Better Auth de l'inscription e-mail/mot de passe, la seule qui recueille l'acceptation. */
const EMAIL_SIGN_UP_PATH = '/sign-up/email'

/** Ce que le hook lit du contexte Better Auth : le chemin de l'endpoint et le corps envoyé. */
type HookContext = { path?: string; body?: unknown } | null | undefined

type TermsFields = { termsVersion: string | null; termsAcceptedAt: Date | null }

/**
 * Hook `databaseHooks.user.create.before` : la vraie garantie d'acceptation des CGU.
 *
 * Inscription e-mail : le corps doit porter `acceptedTermsVersion` égal à la version courante et
 * `ageConfirmed: true`, sinon la création est refusée (aucune ligne écrite, l'erreur annule la
 * transaction de Better Auth). La version et l'horodatage enregistrés viennent du serveur : les
 * champs `termsVersion`/`termsAcceptedAt` sont déclarés `input: false`, Better Auth refuse donc
 * qu'un client les fixe.
 *
 * Toute autre création (callback d'un fournisseur tiers, création interne) n'a recueilli aucune
 * acceptation : le compte naît avec `termsVersion` à null et passera par l'écran de revalidation.
 *
 * Sans version configurée (instance auto-hébergée), les données passent inchangées.
 */
export function applyTermsOnUserCreate<U extends Record<string, unknown>>(
  termsVersion: string | undefined,
  user: U,
  ctx: HookContext,
  now: Date = new Date(),
): { data: U | (U & TermsFields) } {
  if (!termsVersion) return { data: user }
  if (ctx?.path !== EMAIL_SIGN_UP_PATH) {
    return { data: { ...user, termsVersion: null, termsAcceptedAt: null } }
  }
  const body = (ctx.body ?? {}) as { acceptedTermsVersion?: unknown; ageConfirmed?: unknown }
  if (body.ageConfirmed !== true) {
    throw new APIError('BAD_REQUEST', {
      code: TERMS_ACCEPTANCE_REQUIRED,
      message: 'Confirmez que vous avez 15 ans ou plus pour créer un compte.',
    })
  }
  if (body.acceptedTermsVersion !== termsVersion) {
    throw new APIError('BAD_REQUEST', {
      code: TERMS_ACCEPTANCE_REQUIRED,
      message:
        typeof body.acceptedTermsVersion === 'string'
          ? "Les conditions d'utilisation ont changé. Rechargez la page pour lire et accepter la nouvelle version."
          : "Acceptez les conditions d'utilisation pour créer un compte.",
    })
  }
  return { data: { ...user, termsVersion, termsAcceptedAt: now } }
}
