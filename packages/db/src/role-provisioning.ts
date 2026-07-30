import type { Sql } from 'postgres'

/**
 * Provisioning du rôle applicatif restreint (soumis au RLS), exécuté par la connexion
 * PRIVILÉGIÉE (systemDb) au boot. `role` est TOUJOURS une constante interne (`'app_role'`),
 * jamais une entrée utilisateur → l'interpolation du nom est sûre.
 */

/** Crée le rôle s'il n'existe pas (idempotent). `NOSUPERUSER NOBYPASSRLS` = réellement soumis
 * au RLS ; `LOGIN` pour que `appDb` puisse s'y connecter. Sans mot de passe ici (posé par
 * `setAppRolePassword`) ; les GRANTs sont posés par la migration. */
export async function ensureAppRole(systemClient: Sql, role: string): Promise<void> {
  await systemClient.unsafe(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
         CREATE ROLE ${quoteIdent(role)} LOGIN NOSUPERUSER NOBYPASSRLS;
       END IF;
     END $$;`,
  )
}

/** Pose (ou met à jour) le mot de passe du rôle applicatif. Idempotent. */
export async function setAppRolePassword(systemClient: Sql, role: string, password: string): Promise<void> {
  await systemClient.unsafe(`ALTER ROLE ${quoteIdent(role)} PASSWORD ${quoteLiteral(password)}`)
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
