import { normalizeSignupSource } from '@splootlabs/shared'

/** Seule l'inscription e-mail vient du formulaire de l'application, qui transmet `from`. */
const EMAIL_SIGN_UP_PATH = '/sign-up/email'

type HookContext = { path?: string; body?: unknown } | null | undefined

/**
 * Hook `databaseHooks.user.create.before` : enregistre la provenance de l'inscription.
 *
 * Le formulaire d'inscription transmet le `?from=` de son URL dans le champ `from` du corps.
 * Le serveur le normalise (slug court en minuscules) et l'écrit dans `signupSource`, déclaré
 * `input: false` : un client ne peut pas fixer la colonne autrement. Une valeur invalide est
 * ignorée sans faire échouer l'inscription. Aucun cookie ni traceur : rien d'autre n'est conservé.
 */
export function applySignupSource<U extends Record<string, unknown>>(
  user: U,
  ctx: HookContext,
): U & { signupSource: string | null } {
  const from = ctx?.path === EMAIL_SIGN_UP_PATH ? (ctx.body as { from?: unknown } | undefined)?.from : undefined
  return { ...user, signupSource: normalizeSignupSource(from) }
}
