import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

export function registerStatic(app: FastifyInstance, webDistDir: string): void {
  app.register(fastifyStatic, { root: webDistDir, wildcard: false })

  // Fallback SPA : toute route non-API renvoie index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
      // Message affiché tel quel par le front : une route d'API inconnue signale en pratique un
      // serveur qui n'a pas la version attendue par la page.
      reply.code(404).send({ error: "Cette fonctionnalité n'est pas disponible sur ce serveur." })
      return
    }
    reply.sendFile('index.html', webDistDir)
  })
}
