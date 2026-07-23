import { join } from 'node:path'
import { loadConfig } from '@splootlabs/shared'
import { createDb, runMigrations, ensureDefaultTenant } from '@splootlabs/db'
import { createAuth, enabledSocialProviders } from '@splootlabs/auth'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerStatic } from './static.js'

const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)

await runMigrations(db)
if (config.tenancyMode === 'single') await ensureDefaultTenant(db)

let dbUp = true
const app = buildServer(config, { dbStatus: () => (dbUp ? 'up' : 'down') })

const auth = createAuth(db, {
  // En dev, `BETTER_AUTH_SECRET` peut être absent : on retombe sur `SESSION_SECRET`
  // (déjà requis, min 16 caractères) plutôt que d'échouer au démarrage.
  secret: config.authSecret ?? config.sessionSecret,
  baseURL: config.authUrl,
  tenancyMode: config.tenancyMode,
  socialProviders: enabledSocialProviders(config),
})
await registerAuth(app, auth)
registerEditor(app, { db, auth, config })

attachRealtime(app)

// En production, le build du SPA est copié à côté du serveur (voir Dockerfile).
const webDist = process.env.WEB_DIST ?? join(process.cwd(), 'public')
registerStatic(app, webDist)

app.addHook('onClose', async () => {
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
