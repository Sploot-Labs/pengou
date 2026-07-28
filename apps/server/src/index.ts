import { join } from 'node:path'
import { loadConfig } from '@splootlabs/shared'
import { createDb, runMigrations, ensureDefaultTenant, pingDb } from '@splootlabs/db'
import { createAuth, enabledSocialProviders } from '@splootlabs/auth'
import { createEngine, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'
import { PersistentSessionStore } from './persistent-store.js'
import { registerStatic } from './static.js'

const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)

// Migration au boot (P1-9) : pratique en mono-instance ; désactivable (MIGRATE_ON_BOOT=false)
// au profit d'une étape dédiée (`pnpm --filter @splootlabs/server migrate`) en multi-instance.
if (config.migrateOnBoot) await runMigrations(db)
if (config.tenancyMode === 'single') await ensureDefaultTenant(db)

let dbUp = true
const app = await buildServer(config, {
  dbStatus: () => (dbUp ? 'up' : 'down'),
  dbPing: () => pingDb(client),
})

const auth = createAuth(db, {
  // En dev, `BETTER_AUTH_SECRET` peut être absent : on retombe sur `SESSION_SECRET`
  // (déjà requis, min 16 caractères) plutôt que d'échouer au démarrage.
  secret: config.authSecret ?? config.sessionSecret,
  baseURL: config.authUrl,
  tenancyMode: config.tenancyMode,
  nodeEnv: config.nodeEnv,
  disableSignup: config.disableSignup,
  socialProviders: enabledSocialProviders(config),
})
await registerAuth(app, auth)
registerEditor(app, { db, auth, config })

const io = attachRealtime(app, config)

// Honnêteté de configuration (P0-3) : `REDIS_URL` fait passer `config.scaling` à 'redis', mais
// l'adaptateur Redis Socket.IO n'est PAS encore branché et l'état de jeu (Maps de la passerelle,
// minuteurs) reste local au process. Tant que ce n'est pas résolu, le déploiement est
// STRICTEMENT MONO-INSTANCE : ne pas lancer plusieurs répliques derrière un load balancer, sous
// peine d'états divergents entre joueurs. On avertit bruyamment plutôt que de laisser croire au
// scaling annoncé par /health.
if (config.scaling === 'redis') {
  app.log.warn(
    "REDIS_URL est défini mais l'adaptateur Redis Socket.IO n'est pas encore branché : " +
      'déploiement MONO-INSTANCE uniquement (état de jeu et pub/sub temps réel locaux au process). ' +
      'Ne pas exécuter plusieurs instances derrière un load balancer pour le moment.',
  )
}

// Moteur de jeu : une seule instance par process, mais son état survit désormais aux
// redémarrages (Task 3/4, persistance des sessions) — `PersistentSessionStore` fait un
// write-through Postgres (colonne `engine_state`) derrière un cache mémoire, et
// `registerGameGateway` réhydrate au montage les sessions encore actives et récentes
// (`rehydrateActiveSessions`, dans `game-gateway.ts`). Un futur passage à un backend partagé
// (Redis, multi-instance) resterait un simple changement d'implémentation de `SessionStore`.
const sessionStore = new PersistentSessionStore(db)
const engine = createEngine({
  store: sessionStore,
  now: () => Date.now(),
  genPin: generatePin,
  genId: () => crypto.randomUUID(),
})
await registerGameGateway(io, { engine, db, auth, config })

// En production, le build du SPA est copié à côté du serveur (voir Dockerfile).
const webDist = process.env.WEB_DIST ?? join(process.cwd(), 'public')
registerStatic(app, webDist)

app.addHook('onClose', async () => {
  // Arrêt gracieux : écrit d'abord les états de jeu encore coalescés (P0-5), PUIS ferme le pool.
  await sessionStore.flushAll().catch(() => {})
  await client.end({ timeout: 5 })
})

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`serveur démarré sur :${config.port} (${config.tenancyMode}/${config.scaling})`))
  .catch((err) => {
    app.log.error(err)
    dbUp = false
    process.exit(1)
  })

// Fastify n'installe pas de handlers SIGTERM/SIGINT lui-même : sans ça, `docker stop` /
// `docker compose down` tue le process directement et le hook onClose (fermeture du client pg)
// ne s'exécute jamais.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info(`signal ${signal} reçu, arrêt gracieux du serveur...`)
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}
