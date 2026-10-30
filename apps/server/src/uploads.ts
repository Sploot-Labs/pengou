import { mkdirSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

/**
 * Sert en lecture seule les images envoyées (MEDIA_DIR) sous /uploads/.
 * Seconde instance de @fastify/static : decorateReply false pour ne pas entrer en conflit
 * avec celle du SPA (reply.sendFile). Pas d'index, pas de listing, dotfiles refusés.
 */
export function registerUploads(app: FastifyInstance, mediaDir: string): void {
  mkdirSync(mediaDir, { recursive: true })
  app.register(async (scope) => {
    // Un dossier ou un dotfile donne 403 côté @fastify/static : on répond 404 partout, pour ne
    // pas révéler ce qui existe sur le disque.
    scope.setErrorHandler((err, _req, reply) => {
      const status = (err as { statusCode?: number }).statusCode ?? 500
      if (status === 403 || status === 404) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      reply.send(err)
    })
    scope.register(fastifyStatic, {
      root: mediaDir,
      prefix: '/uploads/',
      decorateReply: false,
      index: false,
      list: false,
      dotfiles: 'deny',
      setHeaders: (reply) => {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        reply.header('X-Content-Type-Options', 'nosniff')
      },
    })
  })
}
