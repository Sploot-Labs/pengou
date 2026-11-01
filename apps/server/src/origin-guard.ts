import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@splootlabs/shared'
import { allowedOrigins } from './realtime.js'

/**
 * Vrai si `origin` est absent (clients non navigateurs : outil de charge, tests, curl) ou figure
 * dans la liste. Un navigateur envoie toujours `Origin` sur un upgrade WebSocket et sur un POST
 * inter-origine, donc l'absence ne contourne rien côté navigateur.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (origin === undefined || origin === '') return true
  return allowed.includes(origin)
}

const METHODES_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Garde d'origine des requêtes mutantes de l'API (`/api/*` hors `/api/auth/*`, dont Better Auth
 * contrôle déjà l'origine). Sans elle, une requête sans corps (ex. accepter une invitation)
 * envoyée depuis un sous-domaine frère passe le cookie de session (SameSite compte le site, pas
 * l'origine) et n'est arrêtée par rien. On refuse si `Origin` est présent et hors liste, ou s'il
 * est absent alors que le navigateur signale `Sec-Fetch-Site: cross-site` ou `same-site`.
 */
export function registerOriginGuard(app: FastifyInstance, config: Pick<AppConfig, 'authUrl' | 'nodeEnv'>): void {
  const allowed = allowedOrigins(config)
  app.addHook('onRequest', async (request, reply) => {
    if (!METHODES_MUTANTES.has(request.method)) return
    const chemin = request.url.split('?')[0] ?? ''
    if (!chemin.startsWith('/api/') || chemin.startsWith('/api/auth/')) return

    const origin = request.headers.origin
    const refuse = origin
      ? !isOriginAllowed(origin, allowed)
      : ['cross-site', 'same-site'].includes(String(request.headers['sec-fetch-site']))
    if (refuse) return reply.code(403).send({ error: 'Origine non autorisée.' })
  })
}
