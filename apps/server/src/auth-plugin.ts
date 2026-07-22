import type { FastifyInstance } from 'fastify'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import type { Auth } from '@splootlabs/auth'

// NOTE(déviation) : le brief prévoyait `fastify-better-auth` (`FastifyBetterAuth` +
// `getAuthDecorator`). Ce paquet (v1.2.0) déclare `peerDependencies: { fastify: '5.x' }`
// et échoue au *runtime* (pas juste au warning d'install) : `fastify-plugin` vérifie la
// version au moment du `register` et lève
//   `FastifyError: fastify-plugin: fastify-better-auth - expected '5.x' fastify version, '4.29.1' is installed`
// Le serveur est sur Fastify 4.28/4.29 (upgrade vers 5 hors scope de cette tâche).
// Fallback documenté dans le brief : on monte le handler Better Auth directement sur
// une route Fastify, en réutilisant `toNodeHandler`/`fromNodeHeaders` de `better-auth/node`
// (ce sont exactement les mêmes primitives que `fastify-better-auth` utilise en interne).
export async function registerAuth(app: FastifyInstance, auth: Auth): Promise<void> {
  const authHandler = toNodeHandler(auth)

  // Encapsulé dans un sous-contexte Fastify pour que la désactivation du parsing JSON
  // (Better Auth lit lui-même le corps brut de la requête) ne s'applique qu'aux routes
  // /api/auth/* et n'affecte pas le reste de l'application.
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', (_request, _payload, done) => {
      done(null, null)
    })

    instance.all('/api/auth/*', async (request, reply) => {
      await authHandler(request.raw, reply.raw)
    })
  })

  // Route d'exemple protégée : renvoie l'utilisateur courant, ou 401.
  app.get('/api/me', async (request, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session?.user) return reply.code(401).send({ error: 'Non authentifié.' })
    return { user: session.user }
  })
}
