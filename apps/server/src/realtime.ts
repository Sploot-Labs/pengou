import { Server } from 'socket.io'
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

export function attachRealtime(app: FastifyInstance, config: Pick<AppConfig, 'authUrl' | 'nodeEnv'>): Server {
  const io = new Server(app.server, { cors: { origin: allowedOrigins(config), credentials: true } })

  io.on('connection', (socket) => {
    socket.on('ping:test', (ack?: (msg: string) => void) => {
      if (typeof ack === 'function') ack('pong')
    })
  })

  return io
}
