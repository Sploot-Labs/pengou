import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TENANCY_MODE: z.enum(['single', 'multi']).default('single'),
  DATABASE_URL: z.string().min(1).default('postgres://kahoot:kahoot@localhost:5432/kahoot'),
  REDIS_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please!!'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  SESSION_INACTIVITY_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_SWEEP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
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
  redisUrl?: string
  sessionSecret: string
  scaling: 'memory' | 'redis'
  authSecret?: string
  authUrl: string
  sessionInactivityTimeoutMs: number
  sessionSweepIntervalMs: number
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
    redisUrl: parsed.REDIS_URL,
    sessionSecret: parsed.SESSION_SECRET,
    scaling: parsed.REDIS_URL ? 'redis' : 'memory',
    authSecret: parsed.BETTER_AUTH_SECRET,
    authUrl: parsed.BETTER_AUTH_URL,
    sessionInactivityTimeoutMs: parsed.SESSION_INACTIVITY_TIMEOUT_MINUTES * 60_000,
    sessionSweepIntervalMs: parsed.SESSION_SWEEP_INTERVAL_MINUTES * 60_000,
    oauth: {
      google: { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET },
      facebook: { clientId: parsed.FACEBOOK_CLIENT_ID, clientSecret: parsed.FACEBOOK_CLIENT_SECRET },
      github: { clientId: parsed.GITHUB_CLIENT_ID, clientSecret: parsed.GITHUB_CLIENT_SECRET },
    },
  }
}
