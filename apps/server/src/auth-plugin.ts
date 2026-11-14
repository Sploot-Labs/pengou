import type { FastifyInstance } from 'fastify'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import type { Auth } from '@splootlabs/auth'
import type { AppConfig, LegalConfig } from '@splootlabs/shared'
import { termsAcceptanceRequired } from './legal.js'
import { localizeAuthHandler } from './i18n/localize.js'

// NOTE(déviation) : le brief prévoyait `fastify-better-auth` (`FastifyBetterAuth` +
// `getAuthDecorator`). Ce paquet (v1.2.0) déclare `peerDependencies: { fastify: '5.x' }`
// et échoue au *runtime* (pas juste au warning d'install) : `fastify-plugin` vérifie la
// version au moment du `register` et lève
//   `FastifyError: fastify-plugin: fastify-better-auth - expected '5.x' fastify version, '4.29.1' is installed`
// Le serveur est sur Fastify 4.28/4.29 (upgrade vers 5 hors scope de cette tâche).
// Fallback documenté dans le brief : on monte le handler Better Auth directement sur
// une route Fastify, en réutilisant `toNodeHandler`/`fromNodeHeaders` de `better-auth/node`
// (ce sont exactement les mêmes primitives que `fastify-better-auth` utilise en interne).
export async function registerAuth(
  app: FastifyInstance,
  auth: Auth,
  options: {
    legal?: LegalConfig | null
    mailEnabled?: boolean
    demo?: Pick<AppConfig['demo'], 'enabled' | 'maxPlayers'>
  } = {},
): Promise<void> {
  const legal = options.legal ?? null
  // Better Auth écrit directement sur la réponse Node, hors du crochet onSend de traduction : ses
  // messages d'erreur (en anglais) sont traduits ici par leur code, voir localizeAuthHandler.
  const authHandler = toNodeHandler(localizeAuthHandler(auth.handler))

  // Encapsulé dans un sous-contexte Fastify pour que la désactivation du parsing JSON
  // (Better Auth lit lui-même le corps brut de la requête) ne s'applique qu'aux routes
  // /api/auth/* et n'affecte pas le reste de l'application.
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', (_request, _payload, done) => {
      done(null, null)
    })

    instance.all('/api/auth/*', async (request, reply) => {
      // Constat d'audit `packages/auth/src/auth.ts:betterAuth-rateLimit-untrusted-client-ip` :
      // le limiteur de Better Auth indexe ses compteurs sur X-Forwarded-For, que le client
      // choisit librement (changer l'en-tête remet le compteur à zéro ; l'omettre range tout le
      // monde dans un compteur commun). On le remplace par `request.ip`, que Fastify ne déduit
      // de l'en-tête que derrière un proxy de TRUSTED_PROXIES. Better Auth accepte une IP
      // unique, y compris IPv6 ou IPv4 mappée (`::ffff:a.b.c.d`, ramenée à `a.b.c.d`).
      request.raw.headers['x-forwarded-for'] = request.ip
      await authHandler(request.raw, reply.raw)
    })
  })

  // Publique : ce que le web peut proposer (mot de passe oublié, bandeau de confirmation, partie
  // de démonstration sans compte). Aucun détail sur le transport.
  const mailEnabled = options.mailEnabled ?? false
  // `demoMaxPlayers` : le nombre de joueurs que l'écran /demo annonce au visiteur.
  const demoEnabled = options.demo?.enabled ?? false
  const demoMaxPlayers = options.demo?.maxPlayers ?? 30
  app.get('/api/auth-features', async () => ({ mailEnabled, demoEnabled, demoMaxPlayers }))

  // Sonde de session : renvoie l'utilisateur courant, ou 401. Reste ouverte pendant la
  // revalidation des CGU et indique au client s'il doit afficher l'écran d'acceptation.
  app.get('/api/me', async (request, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session?.user) return reply.code(401).send({ error: 'Non authentifié.' })
    return {
      user: session.user,
      termsAcceptanceRequired: termsAcceptanceRequired(session.user, legal?.termsVersion),
    }
  })
}
