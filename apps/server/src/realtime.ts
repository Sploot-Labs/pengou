import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@splootlabs/shared'

/**
 * CORS Socket.IO : `origin: true` reflète N'IMPORTE QUELLE origine (équivalent à `*` mais avec
 * les credentials autorisés en plus — pire que `*` seul). N'importe quel site tiers pouvait donc
 * ouvrir une connexion Socket.IO authentifiée (cookie de session envoyé au handshake) vers ce
 * serveur. On restreint à l'origine PUBLIQUE de l'app (`AppConfig.authUrl`, déjà la source de
 * vérité pour les callbacks OAuth/cookies Better Auth — donc déjà l'origine attendue des clients
 * légitimes), plus localhost en dev pour ne pas casser le poste de développement (Vite sert le
 * SPA sur un port différent de celui de l'API en dev).
 */
export function allowedOrigins(config: Pick<AppConfig, 'authUrl' | 'nodeEnv'>): string[] {
  const origins = new Set<string>([config.authUrl])
  if (config.nodeEnv !== 'production') {
    origins.add('http://localhost:5173') // port par défaut du serveur de dev Vite (apps/web)
    origins.add('http://127.0.0.1:5173')
  }
  return [...origins]
}

export function attachRealtime(
  app: FastifyInstance,
  config: Pick<AppConfig, 'authUrl' | 'nodeEnv' | 'redisUrl'>,
): Server {
  const io = new Server(app.server, { cors: { origin: allowedOrigins(config), credentials: true } })

  // Adaptateur Redis (P0-3) : quand `REDIS_URL` est défini, le pub/sub Socket.IO passe par Redis
  // → les `io.to(room).emit` se propagent à TOUTES les instances (broadcast cross-instance).
  // C'est la BRIQUE FONDATRICE du multi-instance, mais PAS suffisante à elle seule : l'état de
  // ROUTAGE de la passerelle (pinToSessionId, screenTokenToSessionId, minuteurs) reste LOCAL au
  // process (voir game-gateway.ts) — un `player:join` sur l'instance B avec un PIN créé sur A ne
  // trouverait pas la session. Le multi-instance n'est donc réellement fonctionnel qu'une fois
  // ce routage externalisé (Postgres/Redis) — voir l'avertissement au boot (index.ts) et
  // docs/audit. Branchement défensif : une panne Redis n'empêche jamais le serveur de tourner
  // (repli sur l'adaptateur mémoire, mono-instance).
  if (config.redisUrl) {
    try {
      const pubClient = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: null })
      const subClient = pubClient.duplicate()
      for (const client of [pubClient, subClient]) {
        client.on('error', (err) => app.log.error({ err }, 'Redis (adaptateur Socket.IO) : erreur de connexion'))
      }
      io.adapter(createAdapter(pubClient, subClient))
      app.log.info('Adaptateur Redis Socket.IO branché (pub/sub cross-instance).')
    } catch (err) {
      app.log.error({ err }, "Échec du branchement de l'adaptateur Redis — repli mémoire (mono-instance).")
    }
  }

  io.on('connection', (socket) => {
    socket.on('ping:test', (ack?: (msg: string) => void) => {
      if (typeof ack === 'function') ack('pong')
    })
  })

  return io
}
