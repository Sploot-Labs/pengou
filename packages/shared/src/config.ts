import { z } from 'zod'

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
  APP_DB_PASSWORD: z.string().min(1).default('app-dev-password-change-me'),
  REDIS_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please!!'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  // Sécurité : plafond de requêtes HTTP par IP et par minute (anti-DoS/abus). Volontairement
  // haut par défaut pour ne pas gêner un usage légitime ; à abaisser selon l'exposition.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  // Self-host : fermer l'inscription publique une fois le(s) compte(s) créé(s). 'true' désactive
  // le sign-up e-mail/mot de passe (les comptes existants continuent de se connecter).
  DISABLE_SIGNUP: z.enum(['true', 'false']).default('false'),
  // Appliquer les migrations au démarrage du serveur. Pratique en mono-instance/self-host.
  // Mettre 'false' en multi-instance et lancer les migrations dans une étape DÉDIÉE
  // (`pnpm --filter @splootlabs/server migrate`) avant de démarrer les répliques — évite N
  // migrations concurrentes au boot.
  MIGRATE_ON_BOOT: z.enum(['true', 'false']).default('true'),
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
})

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
  disableSignup: boolean
  migrateOnBoot: boolean
  sessionInactivityTimeoutMs: number
  sessionSweepIntervalMs: number
  maxPlayersPerSession: number
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
    disableSignup: parsed.DISABLE_SIGNUP === 'true',
    migrateOnBoot: parsed.MIGRATE_ON_BOOT === 'true',
    sessionInactivityTimeoutMs: parsed.SESSION_INACTIVITY_TIMEOUT_MINUTES * 60_000,
    sessionSweepIntervalMs: parsed.SESSION_SWEEP_INTERVAL_MINUTES * 60_000,
    maxPlayersPerSession: parsed.MAX_PLAYERS_PER_SESSION,
    oauth: {
      google: { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET },
      facebook: { clientId: parsed.FACEBOOK_CLIENT_ID, clientSecret: parsed.FACEBOOK_CLIENT_SECRET },
      github: { clientId: parsed.GITHUB_CLIENT_ID, clientSecret: parsed.GITHUB_CLIENT_SECRET },
    },
  }
}
