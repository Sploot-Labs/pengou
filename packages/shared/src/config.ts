import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TENANCY_MODE: z.enum(['single', 'multi']).default('single'),
  DATABASE_URL: z.string().min(1).default('file:./data/app.db'),
  REDIS_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please!!'),
})

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  tenancyMode: 'single' | 'multi'
  databaseUrl: string
  redisUrl?: string
  sessionSecret: string
  scaling: 'memory' | 'redis'
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.parse(env)
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    tenancyMode: parsed.TENANCY_MODE,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    sessionSecret: parsed.SESSION_SECRET,
    scaling: parsed.REDIS_URL ? 'redis' : 'memory',
  }
}
