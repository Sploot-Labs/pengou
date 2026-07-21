import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'

export function registerStatic(app: FastifyInstance, webDistDir: string): void {
  app.register(fastifyStatic, { root: webDistDir, wildcard: false })

  // Fallback SPA : toute route non-API renvoie index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
      reply.code(404).send({ error: 'not found' })
      return
    }
    reply.sendFile('index.html', webDistDir)
  })
}
