import { join } from 'node:path'
import { loadConfig } from '@splootlabs/shared'
import { createDb, runMigrations, ensureDefaultTenant } from '@splootlabs/db'
import { buildServer } from './app.js'
import { attachRealtime } from './realtime.js'
import { registerStatic } from './static.js'

const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)

await runMigrations(db)
if (config.tenancyMode === 'single') await ensureDefaultTenant(db)

let dbUp = true
const app = buildServer(config, { dbStatus: () => (dbUp ? 'up' : 'down') })
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
