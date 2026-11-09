import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

export function registerStatic(app: FastifyInstance, webDistDir: string): void {
  app.register(fastifyStatic, { root: webDistDir, wildcard: false })

  // Fallback SPA : toute route non-API renvoie index.html
  app.setNotFoundHandler((req, reply) => {
    // /uploads : un fichier envoyé absent doit répondre 404, jamais index.html en 200.
    if (req.url.startsWith('/api') || req.url.startsWith('/health') || req.url.startsWith('/uploads')) {
      reply.code(404).send({ error: 'not found' })
      return
    }
    reply.sendFile('index.html', webDistDir)
  })
}
