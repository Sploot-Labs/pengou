import type { AppConfig } from '@splootlabs/shared'

/**
 * Pose au boot le mot de passe du rôle applicatif `app_role` (APP_DB_PASSWORD), seulement quand
 * le serveur construit lui-même la connexion de ce rôle à partir de DATABASE_URL. Avec
 * APP_DATABASE_URL, le rôle est géré par l'exploitant : le serveur ne doit pas écraser son mot de
 * passe (ni le remettre à la valeur par défaut, que la garde de configuration laisse passer dans
 * ce cas).
 */
export async function applyAppRolePassword(
  config: Pick<AppConfig, 'appDatabaseUrl' | 'appDbPassword'>,
  setPassword: (password: string) => Promise<void>,
): Promise<void> {
  if (config.appDatabaseUrl !== undefined) return
  await setPassword(config.appDbPassword)
}
