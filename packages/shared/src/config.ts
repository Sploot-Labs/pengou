import { z } from 'zod'

/** Mot de passe de développement d'`app_role` : public, donc interdit en production. */
export const DEFAULT_APP_DB_PASSWORD = 'app-dev-password-change-me'

function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional())
}

function httpUrl(name: string) {
  return z.string().url().refine((v) => /^https?:\/\//.test(v), `${name} doit être une URL http(s).`)
}

/** Date calendaire réelle au format AAAA-MM-JJ (refuse 2026-02-30). */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TENANCY_MODE: z.enum(['single', 'multi']).default('single'),
  DATABASE_URL: z.string().min(1).default('postgres://pengou:pengou@localhost:5432/pengou'),
  // RLS (Slice 2) : connexion du rôle applicatif restreint (soumis au RLS). Optionnelle —
  // par défaut dérivée de DATABASE_URL en substituant user=app_role/APP_DB_PASSWORD (self-host
  // à une seule URL). Fournir explicitement pour un rôle géré (cloud/managed).
  APP_DATABASE_URL: z.string().min(1).optional(),
  // Mot de passe du rôle `app_role` (posé au boot par la connexion privilégiée). Défaut dev.
  APP_DB_PASSWORD: z.string().min(1).default(DEFAULT_APP_DB_PASSWORD),
  REDIS_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please!!'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  // Sécurité : plafond de requêtes HTTP par IP et par minute (anti-DoS/abus). Volontairement
  // haut par défaut pour ne pas gêner un usage légitime ; à abaisser selon l'exposition.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  // Proxys de confiance (reverse proxy devant Pengou), séparés par des virgules : IP, CIDR ou
  // mots-clés de proxy-addr (`loopback`, `linklocal`, `uniquelocal`). Seul un pair de cette liste
  // peut annoncer l'IP du client par X-Forwarded-For. Vide par défaut : l'en-tête est ignoré.
  TRUSTED_PROXIES: z.string().default(''),
  // Self-host : fermer l'inscription publique une fois le(s) compte(s) créé(s). 'true' désactive
  // le sign-up e-mail/mot de passe (les comptes existants continuent de se connecter).
  DISABLE_SIGNUP: z.enum(['true', 'false']).default('false'),
  // Appliquer les migrations au démarrage du serveur. Pratique en mono-instance/self-host.
  // Mettre 'false' en multi-instance et lancer les migrations dans une étape DÉDIÉE
  // (`pnpm --filter @splootlabs/server migrate`) avant de démarrer les répliques — évite N
  // migrations concurrentes au boot.
  MIGRATE_ON_BOOT: z.enum(['true', 'false']).default('true'),
  // Dossier de contenu supplémentaire pour la bibliothèque de questions (fichiers JSON d'instance).
  LIBRARY_EXTRA_DIR: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  SESSION_INACTIVITY_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_SWEEP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
  // Plafond de joueurs inscrits par partie (déconnectés compris). Valeur provisoire, à ajuster
  // d'après les mesures de charge (`docs/charge/`).
  MAX_PLAYERS_PER_SESSION: z.coerce.number().int().positive().default(640),
  // Échecs de PIN (player:join) tolérés par IP, ou par préfixe /64 en IPv6, sur 5 minutes. Haut
  // par défaut : une salle entière derrière une seule IP publique se trompe souvent de PIN.
  PIN_FAILURE_MAX: z.coerce.number().int().positive().default(100),
  // Conditions d'utilisation (CGU) propres à l'instance. Sans LEGAL_TERMS_VERSION, aucune
  // acceptation n'est demandée (self-host par défaut). Une valeur vide vaut une variable absente,
  // ce qui permet le relais `${VAR:-}` de docker compose.
  LEGAL_TERMS_URL: emptyAsUndefined(httpUrl('LEGAL_TERMS_URL')),
  LEGAL_PRIVACY_URL: emptyAsUndefined(httpUrl('LEGAL_PRIVACY_URL')),
  LEGAL_TERMS_VERSION: emptyAsUndefined(
    z.string().refine(isIsoDate, 'LEGAL_TERMS_VERSION doit être une date valide au format AAAA-MM-JJ.'),
  ),
})

/** Version des CGU et liens affichés à l'inscription. `null` : fonction désactivée. */
export type LegalConfig = {
  /** Date des CGU en vigueur (AAAA-MM-JJ), comparée à `user.terms_version`. */
  termsVersion: string
  termsUrl: string
  privacyUrl: string
}

export type OAuthProviderCreds = {
  clientId?: string
  clientSecret?: string
}

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  tenancyMode: 'single' | 'multi'
  databaseUrl: string
  appDatabaseUrl?: string
  appDbPassword: string
  redisUrl?: string
  sessionSecret: string
  scaling: 'memory' | 'redis'
  authSecret?: string
  authUrl: string
  rateLimitMax: number
  /** Proxys dont le X-Forwarded-For est cru (format proxy-addr). Vide : en-tête ignoré. */
  trustedProxies: string[]
  disableSignup: boolean
  migrateOnBoot: boolean
  libraryExtraDir?: string
  sessionInactivityTimeoutMs: number
  sessionSweepIntervalMs: number
  maxPlayersPerSession: number
  /** Échecs de PIN tolérés par IP (préfixe /64 en IPv6) sur la fenêtre du budget. */
  pinFailureMax: number
  /** Acceptation des CGU à l'inscription et revalidation à chaque nouvelle version. */
  legal: LegalConfig | null
  oauth: {
    google: OAuthProviderCreds
    facebook: OAuthProviderCreds
    github: OAuthProviderCreds
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.parse(env)
  if (parsed.NODE_ENV === 'production' && !parsed.BETTER_AUTH_SECRET) {
    throw new Error(
      "Configuration invalide : BETTER_AUTH_SECRET est requis en production (NODE_ENV=production). " +
        'Définissez une valeur secrète stable d\'au moins 32 caractères (ex. `openssl rand -base64 32`) ' +
        'pour signer les sessions Better Auth. En développement/test, une valeur par défaut est tolérée.',
    )
  }
  if (
    parsed.NODE_ENV === 'production' &&
    !parsed.APP_DATABASE_URL &&
    parsed.APP_DB_PASSWORD === DEFAULT_APP_DB_PASSWORD
  ) {
    throw new Error(
      'Configuration invalide : APP_DB_PASSWORD doit être défini en production (mot de passe du rôle app_role).',
    )
  }
  let legal: LegalConfig | null = null
  if (parsed.LEGAL_TERMS_VERSION) {
    if (!parsed.LEGAL_TERMS_URL) {
      throw new Error('Configuration invalide : LEGAL_TERMS_URL est requis quand LEGAL_TERMS_VERSION est défini.')
    }
    if (!parsed.LEGAL_PRIVACY_URL) {
      throw new Error('Configuration invalide : LEGAL_PRIVACY_URL est requis quand LEGAL_TERMS_VERSION est défini.')
    }
    legal = {
      termsVersion: parsed.LEGAL_TERMS_VERSION,
      termsUrl: parsed.LEGAL_TERMS_URL,
      privacyUrl: parsed.LEGAL_PRIVACY_URL,
    }
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    tenancyMode: parsed.TENANCY_MODE,
    databaseUrl: parsed.DATABASE_URL,
    appDatabaseUrl: parsed.APP_DATABASE_URL,
    appDbPassword: parsed.APP_DB_PASSWORD,
    redisUrl: parsed.REDIS_URL,
    sessionSecret: parsed.SESSION_SECRET,
    scaling: parsed.REDIS_URL ? 'redis' : 'memory',
    authSecret: parsed.BETTER_AUTH_SECRET,
    authUrl: parsed.BETTER_AUTH_URL,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    trustedProxies: parsed.TRUSTED_PROXIES.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    disableSignup: parsed.DISABLE_SIGNUP === 'true',
    migrateOnBoot: parsed.MIGRATE_ON_BOOT === 'true',
    libraryExtraDir: parsed.LIBRARY_EXTRA_DIR,
    sessionInactivityTimeoutMs: parsed.SESSION_INACTIVITY_TIMEOUT_MINUTES * 60_000,
    sessionSweepIntervalMs: parsed.SESSION_SWEEP_INTERVAL_MINUTES * 60_000,
    maxPlayersPerSession: parsed.MAX_PLAYERS_PER_SESSION,
    pinFailureMax: parsed.PIN_FAILURE_MAX,
    legal,
    oauth: {
      google: { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET },
      facebook: { clientId: parsed.FACEBOOK_CLIENT_ID, clientSecret: parsed.FACEBOOK_CLIENT_SECRET },
      github: { clientId: parsed.GITHUB_CLIENT_ID, clientSecret: parsed.GITHUB_CLIENT_SECRET },
    },
  }
}
