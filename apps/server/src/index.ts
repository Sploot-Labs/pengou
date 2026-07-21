import { join } from 'node:path'
import { loadConfig } from '@kahoot/shared'
import { buildServer } from './app'
import { attachRealtime } from './realtime'
import { registerStatic } from './static'

const config = loadConfig()
const app = buildServer(config)
attachRealtime(app)

// En production, le build du SPA est copié à côté du serveur (voir Dockerfile).
const webDist = process.env.WEB_DIST ?? join(process.cwd(), 'public')
registerStatic(app, webDist)

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`serveur démarré sur :${config.port} (${config.tenancyMode}/${config.scaling})`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
