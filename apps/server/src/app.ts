import Fastify, { type FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { collectDefaultMetrics, Registry } from 'prom-client'
import type { AppConfig } from '@splootlabs/shared'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route d'un fichier du SPA (posé par registerStatic) : exemptée de la limite de débit. */
    spaAsset?: boolean
  }
}

export type ServerDeps = {
  dbStatus?: () => 'up' | 'down'
  /** Ping DB réel pour la readiness (P1-10) — distinct du `dbStatus` (drapeau statique). */
  dbPing?: () => Promise<boolean>
}

// Observabilité (P1-10) : métriques process/Node (CPU, heap, event-loop lag, GC…) exposées au
// format Prometheus sur /metrics. Registre dédié (pas le registre global) pour éviter les
// doubles inscriptions quand plusieurs `buildServer` coexistent (suites de test).
function buildMetricsRegistry(): Registry {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })
  return registry
}

// `buildServer` est ASYNC et `await`e l'enregistrement des plugins de sécurité :
// dans Fastify, un hook (ici l'`onRequest` de helmet/rate-limit) ne s'applique QU'AUX
// routes déclarées APRÈS lui, et un `register()` non attendu ne charge le plugin qu'au
// `ready()` — donc trop tard pour /health et pour les routes auth/éditeur montées ensuite.
// `await app.register(...)` amorce le plugin immédiatement (les instances Fastify sont
// thenables) → les hooks sont posés avant toute route, protégeant l'ensemble de l'app.
export async function buildServer(config: AppConfig, deps: ServerDeps = {}): Promise<FastifyInstance> {
  // `trustProxy` : Fastify ne lit X-Forwarded-For que si le pair TCP figure dans
  // TRUSTED_PROXIES (IP ou CIDR du reverse proxy). `request.ip` vaut alors le dernier saut non
  // fiable de la chaîne, que le client ne peut pas forger. Liste vide (défaut) : l'en-tête est
  // ignoré et `request.ip` est l'adresse du pair. Auparavant `trustProxy: true` croyait
  // n'importe quel client, ce qui permettait de contourner les limites de débit (constat
  // d'audit `betterAuth-rateLimit-untrusted-client-ip`). Derrière un proxy sans TRUSTED_PROXIES,
  // tous les clients partagent l'IP du proxy : un avertissement est journalisé au démarrage.
  // Logger pino (P1-10) : niveau via LOG_LEVEL (défaut info), et REDACTION des secrets/cookies
  // dans les logs de requêtes (Authorization, Cookie, Set-Cookie) — sans ça, un cookie de session
  // ou un header d'auth se retrouverait en clair dans les logs. Coupé en test.
  const loggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
  }
  const app = Fastify({
    logger: config.nodeEnv !== 'test' ? loggerOptions : false,
    trustProxy: config.trustedProxies.length ? config.trustedProxies : false,
  })

  if (config.nodeEnv === 'production' && config.trustedProxies.length === 0) {
    // Journalisé une fois, au `ready()` déclenché par `listen` au démarrage.
    app.addHook('onReady', async () => {
      app.log.warn(
        'TRUSTED_PROXIES est vide : derrière un reverse proxy, tous les clients partagent la même IP pour les limites de débit.',
      )
    })
  }

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
        // `https:` autorisé pour couvertures/médias externes en http(s) (cohérent avec la
        // validation isSafeMedia côté serveur, qui accepte les URLs http(s)).
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
    // Même origine SPA↔API : COEP casserait le chargement des polices tierces sans bénéfice ici.
    crossOriginEmbedderPolicy: false,
  })

  // Sécurité (P1) : limite de débit globale par IP (anti-DoS/abus, énumération de parties).
  // L'anti-brute-force spécifique de l'authentification est géré par Better Auth (voir
  // createAuth). Socket.IO s'attache au serveur HTTP brut (hors routage Fastify) et n'est
  // donc pas plafonné ici ; le throttle des events joueur est un durcissement à part.
  // Les fichiers du SPA (index.html, bundles, styles, icônes) sont exemptés : une salle de
  // 640 joueurs derrière la même IP publique (NAT d'établissement, wifi d'événement) charge
  // la page des centaines de fois par minute et recevrait des 429 avant même d'ouvrir le
  // socket. L'exemption repose sur le marqueur `spaAsset` que static.ts pose sur les routes de
  // @fastify/static : elle dépend de la route trouvée, pas de l'URL, et le client ne peut donc
  // pas s'en servir pour contourner la limite de l'API, de /health, /ready ou /metrics. Le
  // fallback SPA (gestionnaire 404) n'est pas une route et n'a jamais été compté.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    allowList: (req) => req.routeOptions.config.spaAsset === true,
  })

  // Liveness (P1-10) : le process répond. Volontairement SANS I/O — un /health qui pinguerait la
  // DB ferait redémarrer le pod en boucle sur une simple lenteur DB. La readiness (ci-dessous) est
  // le bon endroit pour tester les dépendances.
  app.get('/health', async () => ({
    status: 'ok',
    db: deps.dbStatus ? deps.dbStatus() : 'unknown',
    tenancyMode: config.tenancyMode,
    scaling: config.scaling,
  }))

  // Readiness (P1-10) : ping DB RÉEL → 200 si prêt, 503 sinon. À câbler sur la `readinessProbe`
  // K8s (n'envoie du trafic qu'aux pods prêts ; ne redémarre pas sur un simple 503 transitoire).
  app.get('/ready', async (_request, reply) => {
    const dbReady = deps.dbPing ? await deps.dbPing() : true
    if (!dbReady) return reply.code(503).send({ status: 'not-ready', db: 'down' })
    return { status: 'ready', db: 'up' }
  })

  // Métriques Prometheus (P1-10). Non plafonné par le rate-limit ? Si, il l'est (route Fastify) —
  // en pratique le scraper est interne ; ajuster RATE_LIMIT_MAX ou une allowlist si besoin.
  const metricsRegistry = buildMetricsRegistry()
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType)
    return metricsRegistry.metrics()
  })

  return app
}
