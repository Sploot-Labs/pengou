import { join } from 'node:path'
import { loadConfig } from '@splootlabs/shared'
import {
  createDb,
  createAppDb,
  deriveAppUrl,
  ensureAppRole,
  setAppRolePassword,
  runMigrations,
  ensureDefaultTenant,
  pingDb,
  syncLibrary,
} from '@splootlabs/db'
import { readCatalog } from '@splootlabs/library'
import { createAuth, enabledSocialProviders } from '@splootlabs/auth'
import { createMailer } from '@splootlabs/mail'
import { createEngine, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { applyAppRolePassword } from './app-role.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { registerLegal } from './legal.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'
import { PersistentSessionStore } from './persistent-store.js'
import { registerStatic } from './static.js'

const config = loadConfig()
// Connexion PRIVILÉGIÉE (propriétaire, bypass RLS) : migrations, provisioning, ops cross-tenant.
const { db: systemDb, client } = createDb(config.databaseUrl)

// RLS (Slice 2) : provisionner le rôle applicatif restreint AVANT les migrations (qui posent
// ses GRANTs) et construire le handle `appDb` (soumis au RLS, GUC par transaction via withTenantTx).
const APP_ROLE = 'app_role'
await ensureAppRole(client, APP_ROLE)
// Mot de passe posé seulement si la connexion app_role est dérivée de DATABASE_URL : avec
// APP_DATABASE_URL, le rôle et son mot de passe sont gérés par l'exploitant (voir app-role.ts).
await applyAppRolePassword(config, (password) => setAppRolePassword(client, APP_ROLE, password))

// Migration au boot (P1-9) : pratique en mono-instance ; désactivable (MIGRATE_ON_BOOT=false)
// au profit d'une étape dédiée (`pnpm --filter @splootlabs/server migrate`) en multi-instance.
if (config.migrateOnBoot) await runMigrations(systemDb)
if (config.tenancyMode === 'single') await ensureDefaultTenant(systemDb)

const appUrl =
  config.appDatabaseUrl ?? deriveAppUrl(config.databaseUrl, { user: APP_ROLE, password: config.appDbPassword })
const { db: appDb, client: appClient } = createAppDb(appUrl)

let dbUp = true
const app = await buildServer(config, {
  dbStatus: () => (dbUp ? 'up' : 'down'),
  dbPing: () => pingDb(client),
})

// Envoi d'e-mails : sans transport, repli journal (désactivé). Jamais une erreur de démarrage.
const mailer = createMailer(config.mail, app.log, { nodeEnv: config.nodeEnv })
if (!mailer.enabled && config.nodeEnv === 'production') {
  app.log.warn(
    "Aucun transport d'e-mail configuré (MAIL_TRANSPORT) : la réinitialisation de mot de passe, " +
      "l'envoi d'invitations et la confirmation d'adresse sont désactivés.",
  )
}

if (config.nodeEnv === 'production' && config.mail.transport === 'smtp' && !config.mail.smtp.requireTls) {
  app.log.warn('SMTP_REQUIRE_TLS=false : les e-mails sont envoyés en SMTP sans TLS obligatoire.')
}

const auth = createAuth(systemDb, {
  // En dev, `BETTER_AUTH_SECRET` peut être absent : on retombe sur `SESSION_SECRET`
  // (déjà requis, min 16 caractères) plutôt que d'échouer au démarrage.
  secret: config.authSecret ?? config.sessionSecret,
  baseURL: config.authUrl,
  tenancyMode: config.tenancyMode,
  nodeEnv: config.nodeEnv,
  disableSignup: config.disableSignup,
  socialProviders: enabledSocialProviders(config),
  mailer,
  mailTransport: config.mail.transport,
  emailDomainCheck: config.emailDomainCheck,
  logger: app.log,
  termsVersion: config.legal?.termsVersion,
})
await registerAuth(app, auth, { legal: config.legal, mailEnabled: mailer.enabled })
registerLegal(app, { db: systemDb, auth, legal: config.legal })
// Bibliothèque de questions : lecture du catalogue (livré + dossier d'instance) puis synchronisation
// en base. Une erreur sur le catalogue livré lève ici et fait échouer le démarrage, comme une
// migration en échec ; un fichier d'instance invalide est seulement journalisé et écarté.
const snapshot = await readCatalog({ extraDir: config.libraryExtraDir, log: (m) => app.log.error(m) })
const libraryCounts = await syncLibrary(systemDb, snapshot)
app.log.info(libraryCounts, 'catalogue de la bibliothèque synchronisé')
registerEditor(app, { systemDb, appDb, auth, config, mailer })

const io = attachRealtime(app, config)

// Honnêteté de configuration (P0-3) : avec `REDIS_URL`, l'adaptateur Redis Socket.IO est branché
// (pub/sub cross-instance, voir attachRealtime), MAIS l'état de ROUTAGE de la passerelle
// (pinToSessionId, tokens d'écran, minuteurs) reste LOCAL au process. Le multi-instance n'est donc
// PAS encore pleinement fonctionnel (un player:join sur une autre instance ne retrouve pas le PIN).
// Tant que ce routage n'est pas externalisé, garder un déploiement MONO-INSTANCE. On avertit
// bruyamment plutôt que de laisser croire au scaling annoncé par /health.
if (config.scaling === 'redis') {
  app.log.warn(
    "REDIS_URL défini : adaptateur Redis Socket.IO branché (pub/sub cross-instance), mais l'état " +
      'de routage de la passerelle reste local au process → multi-instance PAS encore pleinement ' +
      'fonctionnel. Garder UNE seule instance tant que le routage (PIN→session, tokens, minuteurs) ' +
      "n'est pas externalisé.",
  )
}

// Moteur de jeu : une seule instance par process, mais son état survit désormais aux
// redémarrages (Task 3/4, persistance des sessions) — `PersistentSessionStore` fait un
// write-through Postgres (colonne `engine_state`) derrière un cache mémoire, et
// `registerGameGateway` réhydrate au montage les sessions encore actives et récentes
// (`rehydrateActiveSessions`, dans `game-gateway.ts`). Un futur passage à un backend partagé
// (Redis, multi-instance) resterait un simple changement d'implémentation de `SessionStore`.
const store = new PersistentSessionStore(systemDb)
const engine = createEngine({
  store,
  now: () => Date.now(),
  genPin: generatePin,
  genId: () => crypto.randomUUID(),
})
const gateway = await registerGameGateway(io, { engine, systemDb, appDb, auth, config, store })

// Balayage périodique des parties inactives (mono-instance). `.unref()` : ne maintient jamais le
// process en vie à lui seul. Erreurs loggées, jamais propagées (un tick ne doit pas tuer le serveur).
const sweepTimer = setInterval(() => {
  gateway.sweepAbandonedSessions().catch((err) => app.log.error(err, 'balayage des parties inactives échoué'))
}, config.sessionSweepIntervalMs)
sweepTimer.unref()

// En production, le build du SPA est copié à côté du serveur (voir Dockerfile).
const webDist = process.env.WEB_DIST ?? join(process.cwd(), 'public')
registerStatic(app, webDist, { publicUrl: config.authUrl, noindex: config.robotsNoindex })

app.addHook('onClose', async () => {
  // Arrêt gracieux : écrit d'abord les états de jeu encore coalescés (P0-5), arrête le balayage,
  // PUIS ferme le pool.
  await store.flushAll().catch(() => {})
  clearInterval(sweepTimer)
  await appClient.end({ timeout: 5 })
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
