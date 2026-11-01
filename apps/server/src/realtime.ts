import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@splootlabs/shared'
import { allowedOrigins, isOriginAllowed } from './origin-guard.js'

/**
 * CORS Socket.IO : `origin: true` reflétait N'IMPORTE QUELLE origine, credentials compris : un
 * site tiers pouvait ouvrir une connexion authentifiée (cookie envoyé au handshake). On restreint
 * aux origines de `allowedOrigins` (voir origin-guard.ts).
 */
export function attachRealtime(
  app: FastifyInstance,
  config: Pick<AppConfig, 'authUrl' | 'nodeEnv' | 'redisUrl'>,
): Server {
  const io = new Server(app.server, {
    cors: { origin: allowedOrigins(config), credentials: true },
    // CORS ne couvre que le polling : l'upgrade WebSocket n'est pas soumis à la politique CORS du
    // navigateur, on vérifie donc l'origine ici (absente = client non navigateur, accepté).
    // Une origine de même hôte que `Host` est acceptée (même origine, voir isOriginAllowed).
    allowRequest: (req, cb) => cb(null, isOriginAllowed(req.headers.origin, allowedOrigins(config), req.headers.host)),
  })

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
