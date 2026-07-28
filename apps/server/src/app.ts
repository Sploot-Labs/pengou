import Fastify, { type FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { AppConfig } from '@splootlabs/shared'

export type ServerDeps = { dbStatus?: () => 'up' | 'down' }

// `buildServer` est ASYNC et `await`e l'enregistrement des plugins de sécurité :
// dans Fastify, un hook (ici l'`onRequest` de helmet/rate-limit) ne s'applique QU'AUX
// routes déclarées APRÈS lui, et un `register()` non attendu ne charge le plugin qu'au
// `ready()` — donc trop tard pour /health et pour les routes auth/éditeur montées ensuite.
// `await app.register(...)` amorce le plugin immédiatement (les instances Fastify sont
// thenables) → les hooks sont posés avant toute route, protégeant l'ensemble de l'app.
export async function buildServer(config: AppConfig, deps: ServerDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.nodeEnv !== 'test' })

  // Sécurité (P2) : en-têtes HTTP durcis (anti-clickjacking, anti-sniffing MIME, Referrer-Policy…).
  // CSP réglée pour rester compatible avec le SPA servi par le même serveur : styles inline
  // (framer-motion), polices Google (voir index.html), images data:/blob:, et connexions
  // websocket (Socket.IO). À resserrer si les polices sont self-hostées (cf. DEV-HANDOFF).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
    // Même origine SPA↔API : COEP casserait le chargement des polices tierces sans bénéfice ici.
    crossOriginEmbedderPolicy: false,
  })

  // Sécurité (P1) : limite de débit globale par IP (anti-DoS/abus, énumération de parties).
  // L'anti-brute-force spécifique de l'authentification est géré par Better Auth (voir
  // createAuth). Socket.IO s'attache au serveur HTTP brut (hors routage Fastify) et n'est
  // donc pas plafonné ici — le throttle des events joueur est un durcissement à part.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: '1 minute',
  })

  app.get('/health', async () => ({
    status: 'ok',
    db: deps.dbStatus ? deps.dbStatus() : 'unknown',
    tenancyMode: config.tenancyMode,
    scaling: config.scaling,
  }))

  return app
}
