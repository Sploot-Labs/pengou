import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from '@kahoot/shared'

export function buildServer(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== 'test' })

  app.get('/health', async () => ({
    status: 'ok',
    tenancyMode: config.tenancyMode,
    scaling: config.scaling,
  }))

  return app
}
