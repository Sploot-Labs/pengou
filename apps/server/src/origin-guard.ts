import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@splootlabs/shared'

/**
 * Origines autorisées pour les requêtes navigateur (CORS et upgrade Socket.IO, garde des requêtes
 * mutantes) : l'origine PUBLIQUE de l'app (`AppConfig.authUrl`, déjà la source de vérité pour les
 * callbacks OAuth et cookies Better Auth), plus localhost en dev (Vite sert le SPA sur un autre
 * port que l'API). `authUrl` est réduite à son origine : une barre finale, un chemin ou un port
 * par défaut dans BETTER_AUTH_URL ne doivent pas faire refuser l'app elle-même.
 */
export function allowedOrigins(config: Pick<AppConfig, 'authUrl' | 'nodeEnv'>): string[] {
  const origins = new Set<string>([new URL(config.authUrl).origin])
  if (config.nodeEnv !== 'production') {
    origins.add('http://localhost:5173') // port par défaut du serveur de dev Vite (apps/web)
    origins.add('http://127.0.0.1:5173')
  }
  return [...origins]
}

/**
 * Vrai si `origin` est absent (clients non navigateurs : outil de charge, tests, curl), figure
 * dans la liste, ou désigne le même hôte que l'en-tête `Host` de la requête (contrôle même
 * origine : démarrage rapide en LAN, où les élèves ouvrent `http://<IP-du-portable>:3000` alors
 * que BETTER_AUTH_URL vaut localhost). Un sous-domaine frère n'a pas le même hôte et reste
 * refusé. Un navigateur envoie toujours `Origin` sur un upgrade WebSocket et sur un POST
 * inter-origine, donc l'absence ne contourne rien côté navigateur.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[], host?: string): boolean {
  if (origin === undefined || origin === '') return true
  if (allowed.includes(origin)) return true
  if (!host) return false
  try {
    return new URL(origin).host === host.toLowerCase()
  } catch {
    return false
  }
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
      ? !isOriginAllowed(origin, allowed, request.headers.host)
      : ['cross-site', 'same-site'].includes(String(request.headers['sec-fetch-site']))
    if (refuse) return reply.code(403).send({ error: 'Origine non autorisée.' })
  })
}
