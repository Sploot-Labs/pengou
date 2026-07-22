import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from '@splootlabs/shared'

export type ServerDeps = { dbStatus?: () => 'up' | 'down' }

export function buildServer(config: AppConfig, deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== 'test' })

  app.get('/health', async () => ({
    status: 'ok',
    db: deps.dbStatus ? deps.dbStatus() : 'unknown',
    tenancyMode: config.tenancyMode,
    scaling: config.scaling,
  }))

  return app
}
