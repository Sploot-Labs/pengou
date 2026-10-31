import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

export function registerStatic(app: FastifyInstance, webDistDir: string): void {
  // Contexte encapsulé : le hook `onRoute` ne voit que les routes des fichiers du SPA déclarées
  // par @fastify/static, et les marque `spaAsset` pour l'exemption de la limite de débit (voir
  // app.ts). Le marquage vient de la route trouvée, jamais de l'URL envoyée par le client.
  app.register(async (spa) => {
    spa.addHook('onRoute', (routeOptions) => {
      routeOptions.config = { ...routeOptions.config, spaAsset: true }
    })
    await spa.register(fastifyStatic, { root: webDistDir, wildcard: false })

    // Fallback SPA : toute route non-API renvoie index.html. Déclaré dans le même contexte pour
    // disposer de `reply.sendFile` ; il couvre tout le serveur, ce contexte n'ayant pas de préfixe.
    spa.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      reply.sendFile('index.html', webDistDir)
    })
  })
}
