import type { Server, Socket } from 'socket.io'
import { fromNodeHeaders } from 'better-auth/node'
import {
  resolveTenantId,
  getMembershipRole,
  withTenantTx,
  getQuiz,
  listQuestions,
  createGameSession,
  getGameSessionById,
  addSessionPlayer,
  recordAnswer,
  setSessionStatus,
  setPlayerScore,
  clearEngineState,
  listResumableSessions,
  abandonStaleSessions,
  abandonInactiveSessions,
  listSessionPlayers,
  deleteSessionPlayer,
  setWordcloudRemoved,
  type ContentSource,
  type Db,
} from '@splootlabs/db'
import type { Auth } from '@splootlabs/auth'
import { hasPermission, type AppConfig } from '@splootlabs/shared'
import {
  PlayerKickedError,
  type Engine,
  type EngineQuestion,
  type GameSession,
  type SessionStore,
} from '@splootlabs/game'
import { WORDCLOUD_MAX_WORD_LENGTH, wordKey } from '@splootlabs/quiz'
import { clientIpFromRequest, compileTrust, pinFailureKey } from './client-ip.js'
import { FailureBudget } from './failure-budget.js'

export type GameGatewayDeps = {
  engine: Engine
  /** Connexion privilégiée (bypass RLS) : boot rehydration, sweep, store moteur, bookkeeping
   * `engine_state` — opérations système/cross-tenant sans contexte tenant par requête. */
  systemDb: Db
  /** Connexion applicative restreinte (soumise au RLS) : opérations de contenu scopées à un
   * tenant (host:create, join, réponses, scores) via `withTenantTx(appDb, { tenantId }, …)`. */
  appDb: Db
  auth: Auth
  config: AppConfig
  store: SessionStore
  /** Fenêtre de coalescence de la diffusion du lobby, `LOBBY_BROADCAST_INTERVAL_MS` par défaut.
   * Réglable pour les tests seulement : une fenêtre très longue garantit qu'une diffusion différée
   * est encore en attente au moment voulu, quelle que soit la charge de la machine. */
  lobbyBroadcastIntervalMs?: number
}

/** Métadonnées côté passerelle reliant une session moteur (mémoire) à sa persistance en base. */
type SessionMeta = {
  dbSessionId: string
  tenantId: string
  /** Sources distinctes des questions (copiées de la bibliothèque), jointes au `podium` pour que
   * le grand écran crédite leurs auteurs en fin de partie. Vide pour un quiz écrit à la main. */
  sources: ContentSource[]
  /** playerId moteur (genId()) → id de ligne `session_player` en base (ids indépendants). */
  playerDbIds: Map<string, string>
  /** Index de question déjà persistés (recordAnswer) — évite un double-insert si host:reveal
   * (ou host:skip, qui crédite/persiste aussi — voir `doSkip`) est invoqué plusieurs fois sur
   * la même manche. */
  revealedRounds: Set<number>
  /** Écritures en cours par index de manche (`persistRound`). Une manche entre dans
   * `revealedRounds` dès le DÉBUT de son écriture : un second appelant (host:reveal après une
   * auto-révélation) attend cette promesse au lieu de répondre avant que la base soit à jour, et
   * le podium les attend toutes avant de clore la partie. */
  roundWrites: Map<number, Promise<void>>
  /** Index de question déjà auto-révélés (voir `player:answer`) — garde d'émission unique :
   * évite un double `question:reveal`/`scoreboard` si les deux dernières réponses d'une manche
   * arrivent quasi simultanément (deux appels concurrents à `player:answer`). */
  autoRevealedRounds: Set<number>
  /** `game_session.status` ne passe à 'active' qu'une seule fois (au premier host:start) :
   * un ré-appel écraserait sinon `startedAt` à chaque question suivante. */
  statusActiveSet: boolean
  /** Minuteur serveur planifiant la révélation automatique de fin de lecture (phase 'reading' →
   * 'question', voir `startQuestionFlow`/`revealAnswersFlow`). `null` hors phase 'reading' ou une
   * fois consommé/annulé. Toujours nettoyé via `clearReadingTimeout` avant toute transition
   * manuelle anticipée (host:reveal/host:skip/host:next) ou fin de session — sans ça, une
   * révélation fantôme se déclencherait après coup sur une manche déjà avancée par ailleurs. */
  readingTimeout: ReturnType<typeof setTimeout> | null
  /** Minuteur serveur AUTORITATIF de la phase 'question' (P1-7) : à l'expiration de `timeLimit`,
   * la manche est auto-révélée (`doRevealBySession`). Sans lui, `timeLimit` n'était qu'un décompte
   * CLIENT : hôte déconnecté + un joueur qui ne répond jamais → manche ouverte indéfiniment côté
   * serveur. `null` hors phase 'question' ou une fois consommé/annulé. Toujours nettoyé
   * (`clearQuestionTimeout`) avant toute transition (reveal/skip/next) ou fin de session. */
  questionTimeout: ReturnType<typeof setTimeout> | null
  /** Enchaînement automatique des étapes (demande produit) : quand actif, la session avance seule
   * de l'étape classement vers la question suivante (ou le podium) après `autoAdvanceDelayMs`, sans
   * geste de l'hôte. Activé par défaut ; l'hôte bascule via `host:setAuto`. */
  autoAdvance: boolean
  /** Délai (ms) de la pause sur le classement avant l'avance automatique vers l'étape suivante.
   * Borné côté `host:setAuto`. 10 s par défaut. */
  autoAdvanceDelayMs: number
  /** Minuteur planifiant l'avance automatique vers l'étape suivante (voir `scheduleAutoAdvance`).
   * `null` hors étape classement, ou une fois consommé/annulé. Toujours nettoyé
   * (`clearAdvanceTimeout`) avant toute transition manuelle/auto ou fin de session — sinon une
   * avance fantôme se déclencherait sur une manche déjà avancée par ailleurs. */
  advanceTimeout: ReturnType<typeof setTimeout> | null
  /** Horodatage serveur (ms epoch) de la bascule automatique planifiée, diffusé aux clients
   * (`auto:advance`) pour le compte à rebours, et rejoué au snapshot de reconnexion hôte. `null`
   * quand aucune avance n'est planifiée. */
  advanceNextAt: number | null
  /** Places prises (joueurs inscrits + arrivées en cours), lu et incrémenté sans await entre les deux.
   * Compteur synchrone : `player:join` réserve sa place AVANT tout `await` (sinon des arrivées
   * concurrentes dépasseraient `config.maxPlayersPerSession`) et la rend si l'ajout moteur échoue. */
  seatsTaken: number
  /** Diffusion différée du lobby (voir `scheduleLobbyBroadcast`) : au plus un minuteur en attente
   * par session. `null` quand aucune diffusion n'est planifiée. Annulé à la fin de session
   * (`clearLobbyBroadcastTimeout`) comme les autres minuteurs. */
  lobbyBroadcastTimeout: ReturnType<typeof setTimeout> | null
  /** Horodatage (ms epoch) de la dernière diffusion du lobby pour cette session, 0 si aucune. */
  lastLobbyBroadcastAt: number
  /** Diffusion différée du nuage de mots (voir `scheduleWordcloudBroadcast`) : au plus un minuteur
   * en attente par session, `null` sinon. Annulé à chaque nouvelle question et en fin de session. */
  wordcloudBroadcastTimeout: ReturnType<typeof setTimeout> | null
  /** Horodatage (ms epoch) de la dernière diffusion `wordcloud:update`, 0 si aucune. */
  lastWordcloudBroadcastAt: number
}

/** Refus de `player:join` quand la partie a atteint `config.maxPlayersPerSession`. */
export const SESSION_FULL_MESSAGE = 'La partie est complète.'

/** Fenêtre de coalescence de la diffusion du lobby : au plus une diffusion `lobby:update` /
 * `lobby:count` par session et par fenêtre. Une rafale d'arrivées ne coûte donc plus une
 * diffusion de la liste complète par joueur (coût quadratique en nombre de joueurs). */
const LOBBY_BROADCAST_INTERVAL_MS = 250

/** Cadence du nuage de mots : au plus une diffusion `wordcloud:update` par session et par fenêtre,
 * et seulement après un changement (nouveau mot ou retrait). */
const WORDCLOUD_BROADCAST_INTERVAL_MS = 500

/** Valeurs par défaut de l'enchaînement automatique à la création d'une session. */
const DEFAULT_AUTO_ADVANCE = true
const DEFAULT_AUTO_ADVANCE_DELAY_MS = 10_000
/** Bornes du délai réglable via `host:setAuto` (secondes) — garde-fou anti-valeur absurde. */
const MIN_AUTO_ADVANCE_DELAY_S = 1
const MAX_AUTO_ADVANCE_DELAY_S = 120

type SocketData = {
  role?: 'host' | 'player' | 'screen'
  sessionId?: string
  playerId?: string
  /** Fenêtre de throttle par socket (anti-DoS d'events, P2). */
  rateWindowStart?: number
  rateCount?: number
  /** Clé du budget d'échecs de PIN (IP du client), calculée une fois à la connexion. Absente si
   * l'IP est inconnue : la socket échappe alors au budget plutôt que de partager une clé commune. */
  pinFailureKey?: string
}

/** Throttle par socket (P2) : Socket.IO court-circuite le rate-limit HTTP (serveur brut), donc
 * les events (`player:join`/`player:answer`/`host:*`) n'ont sinon aucune borne de fréquence —
 * un seul socket pourrait inonder Postgres d'INSERT/UPDATE. Fenêtre glissante généreuse : le jeu
 * légitime reste très en-dessous, un flood (milliers/s) est coupé net. */
const SOCKET_RATE_WINDOW_MS = 10_000
const SOCKET_RATE_MAX = 240

/** Budget d'échecs de PIN par IP (audit) : le throttle par socket ne suffit pas, il suffit
 * d'ouvrir d'autres sockets pour deviner des PIN sans limite. Seuls les échecs de `player:join`
 * comptent (PIN inconnu, session introuvable) : une classe derrière une seule IP publique peut
 * se tromper de PIN plusieurs fois sans bloquer la salle. Le plafond vient de PIN_FAILURE_MAX
 * (`config.pinFailureMax`, 100 par défaut). `player:reconnect` n'y est pas soumis (voir son
 * handler). */
const PIN_FAILURE_WINDOW_MS = 5 * 60_000
/** Refus de `player:join` quand le budget d'échecs de PIN est épuisé. */
const PIN_BLOCKED_MESSAGE = 'trop de tentatives, réessayez dans quelques minutes'
/** Réponse unique de `player:reconnect` à tout échec de PIN ou de jeton : distinguer un PIN
 * inconnu d'un jeton faux révélait quels PIN sont en cours de partie. */
const RECONNECT_INVALID_MESSAGE = 'PIN ou jeton invalide'

function roomName(sessionId: string): string {
  return `session:${sessionId}`
}

/** Room des seuls hôte et grand écran : `screen:progress` n'a pas à être envoyé aux joueurs
 * (N réponses feraient N diffusions vers N sockets, soit un coût quadratique par question). */
function viewersRoomName(sessionId: string): string {
  return `viewers:${sessionId}`
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'erreur inconnue'
}

/** Un seul type de question en base pour l'instant : pas de champ `basePoints` dédié au schéma
 * (voir plan, notes de fin) : 1000 par défaut, barème standard d'un quiz en direct. */
const DEFAULT_BASE_POINTS = 1000

/** Fenêtre de reprise (Task 4, réhydratation au boot) : une session `lobby`/`active` plus
 * ancienne que ça au démarrage n'est plus considérée reprenable (`abandonStaleSessions` la bascule
 * en `abandoned`, `engine_state` effacé) — évite de ressusciter indéfiniment une partie abandonnée
 * après un très long redémarrage. 12 h, cohérent avec la durée réaliste d'une session de jeu. */
const SESSION_MAX_AGE = 12 * 3600_000

/** Délai de grâce avant éviction mémoire d'une partie terminée (P1-6). On NE purge pas au
 * podium immédiatement : l'hôte/les joueurs peuvent se reconnecter pour revoir le podium
 * juste après la fin. Passé ce délai, on libère les structures locales (Maps de la passerelle
 * + cache du store) — sinon chaque partie jouée fuit indéfiniment en mémoire. Le redémarrage
 * serveur n'est pas un problème (mémoire repartie de zéro, session déjà `ended` en DB donc non
 * réhydratée). 10 min : large pour un post-partie, borné pour la mémoire. */
const PODIUM_EVICTION_DELAY = 10 * 60_000

function toEngineQuestion(row: {
  id: string
  type: string
  prompt: string
  timeLimit: number
  readingTime: number
  payload: unknown
  media: string | null
  mediaAlt: string | null
}): EngineQuestion {
  return {
    id: row.id,
    type: row.type as EngineQuestion['type'],
    prompt: row.prompt,
    timeLimit: row.timeLimit,
    readingTime: row.readingTime,
    basePoints: DEFAULT_BASE_POINTS,
    payload: row.payload,
    media: row.media,
    mediaAlt: row.mediaAlt,
  }
}

/** Sources distinctes d'une liste de questions, dans leur ordre d'apparition. */
function distinctSources(rows: Array<{ source: ContentSource | null }>): ContentSource[] {
  const byKey = new Map<string, ContentSource>()
  for (const { source } of rows) {
    if (source) byKey.set(JSON.stringify([source.name, source.url ?? '', source.license]), source)
  }
  return [...byKey.values()]
}

/** Refus d'une commande hôte quand l'autorité n'est plus valide (session Better Auth absente ou
 * expirée, utilisateur qui n'est plus l'hôte, ou retiré de l'espace). */
const HOST_REVOKED_MESSAGE = "votre session a expiré ou vous n'êtes plus membre de cet espace"

function playersPayload(
  session: GameSession,
): Array<{ id: string; nickname: string; score: number; connected: boolean }> {
  return Object.values(session.players).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    connected: p.connected,
  }))
}

export async function registerGameGateway(
  io: Server,
  deps: GameGatewayDeps,
): Promise<{ sweepAbandonedSessions: () => Promise<void> }> {
  const { engine, systemDb, appDb, auth, config, store, lobbyBroadcastIntervalMs = LOBBY_BROADCAST_INTERVAL_MS } = deps

  // État de la passerelle : local à CET appel de registerGameGateway (donc à CETTE instance
  // `io`) — pas de Map au niveau module, pour ne pas fuiter entre plusieurs serveurs
  // (ex. plusieurs suites de test dans le même process).
  const sessionMetaByEngineId = new Map<string, SessionMeta>()
  const pinToSessionId = new Map<string, string>()
  // Reprise depuis Home (Task 8) : `Home.tsx` liste les parties via `listSessions()`
  // (`packages/db/src/repos/reports.ts`), qui expose l'id `game_session` PERSISTÉ. Depuis
  // l'unification moteur↔DB (Task 2), c'est EXACTEMENT le même id que `session.id` EN MÉMOIRE
  // (celui que porte `/host/:sessionId` juste après `host:create`, voir `useLaunchGame.ts`) —
  // un seul espace d'id, `sessionMetaByEngineId.get(sessionId)` suffit donc directement dans
  // `host:reconnect` (plus de table de correspondance inverse `dbSessionIdToEngineId`).
  // Token d'affichage grand écran : émis une seule fois par host:createScreenToken, mais
  // valable pour toute la durée de vie de la session (single-*issue*, multi-*join*) — pas de
  // Map au niveau module, pas de suppression après consommation. `screen:join` (première prise
  // de contrôle) reste à usage unique via `consumedScreenTokens` ci-dessous ; `screen:reconnect`
  // réutilise EXACTEMENT le même token (déjà connu du client, ex. localStorage) pour rejoindre
  // à nouveau après une coupure réseau — sans ça, un simple blip réseau tuait le projecteur
  // définitivement (le token étant déjà consommé, il ne pouvait plus jamais rejoindre).
  const screenTokenToSessionId = new Map<string, string>()
  // Un token de `screen:join` initial ne peut être consommé qu'une fois (empêche un second
  // écran de voler la place avec un token fuité APRÈS la prise de contrôle légitime) — mais
  // rejoindre à nouveau APRÈS consommation reste possible via `screen:reconnect`.
  const consumedScreenTokens = new Set<string>()
  // Socket ACTUELLEMENT actif pour chaque joueur (mis à jour par player:join ET player:reconnect).
  // Garde contre la course reconnexion-rapide : Socket.IO peut détecter la coupure d'un socket
  // mort jusqu'à ~pingTimeout après qu'un nouveau socket ait déjà repris le même joueur via
  // player:reconnect — sans cette Map, le `disconnect` tardif de l'ANCIEN socket écraserait
  // `connected:false` sur un joueur pourtant déjà reconnecté.
  const activeSocketIdByPlayerId = new Map<string, string>()
  // Budget d'échecs de PIN, partagé par toutes les sockets d'une même IP, ou d'un même /64 en
  // IPv6 (voir PIN_FAILURE_WINDOW_MS et pinFailureKey).
  const pinFailures = new FailureBudget({ max: config.pinFailureMax, windowMs: PIN_FAILURE_WINDOW_MS })
  const trustProxy = compileTrust(config.trustedProxies)

  /** Refuse la tentative si l'IP de la socket a épuisé son budget d'échecs de PIN. */
  function assertPinBudget(socket: Socket): void {
    const key = (socket.data as SocketData).pinFailureKey
    if (key !== undefined && pinFailures.isBlocked(key)) throw new Error(PIN_BLOCKED_MESSAGE)
  }

  /** Compte un échec de PIN de `player:join` pour l'IP de la socket. */
  function recordPinFailure(socket: Socket): void {
    const key = (socket.data as SocketData).pinFailureKey
    if (key !== undefined) pinFailures.recordFailure(key)
  }

  /** Annule le minuteur de fin de lecture planifié (voir `SessionMeta.readingTimeout`), s'il y en
   * a un en attente — sûr à appeler inconditionnellement (no-op si `null`). Appelé au tout début
   * de toute transition manuelle anticipée (`host:reveal`, `host:skip`, `host:next`) et à la fin
   * de session, pour qu'une révélation planifiée ne se déclenche jamais après coup sur une manche
   * déjà avancée par ailleurs (idempotence : une seule révélation par manche). */
  function clearReadingTimeout(meta: SessionMeta): void {
    if (meta.readingTimeout) {
      clearTimeout(meta.readingTimeout)
      meta.readingTimeout = null
    }
  }

  /** Annule le minuteur autoritatif de fin de question (`SessionMeta.questionTimeout`), s'il y en
   * a un en attente. Sûr à appeler inconditionnellement (no-op si `null`). Appelé au début de
   * toute transition manuelle/auto (reveal/skip/next), à la fin de session, et avant de
   * (re)planifier — pour qu'une auto-révélation planifiée ne se déclenche jamais après coup sur
   * une manche déjà avancée par ailleurs (idempotence : une seule révélation par manche). */
  function clearQuestionTimeout(meta: SessionMeta): void {
    if (meta.questionTimeout) {
      clearTimeout(meta.questionTimeout)
      meta.questionTimeout = null
    }
  }

  /** Annule le minuteur d'avance automatique (`SessionMeta.advanceTimeout`), s'il y en a un en
   * attente, et oublie l'horodatage planifié. Sûr à appeler inconditionnellement (no-op si `null`).
   * Appelé au début de toute transition (manuelle ou auto), quand l'hôte désactive le mode auto, et
   * à la fin de session — pour qu'une avance planifiée ne se déclenche jamais après coup sur une
   * manche déjà avancée par ailleurs (idempotence : une seule avance par étape classement). */
  function clearAdvanceTimeout(meta: SessionMeta): void {
    if (meta.advanceTimeout) {
      clearTimeout(meta.advanceTimeout)
      meta.advanceTimeout = null
    }
    meta.advanceNextAt = null
  }

  /** Annule la diffusion différée du lobby (`SessionMeta.lobbyBroadcastTimeout`), s'il y en a une
   * en attente. Sûr à appeler inconditionnellement (no-op si `null`). Appelé à la fin de session
   * pour qu'aucun minuteur ne survive à sa session. */
  function clearLobbyBroadcastTimeout(meta: SessionMeta): void {
    if (meta.lobbyBroadcastTimeout) {
      clearTimeout(meta.lobbyBroadcastTimeout)
      meta.lobbyBroadcastTimeout = null
    }
  }

  /** Diffuse l'état courant du lobby : la liste complète (`lobby:update`) à l'hôte et au grand
   * écran seulement (room `viewers:<id>`), le seul nombre de joueurs connectés (`lobby:count`) à
   * toute la room. Relit la session au moment de partir, pour que la dernière diffusion d'une
   * rafale reflète l'état final. Session disparue entre-temps (fin de partie, balayage) : rien
   * n'est émis, aucune erreur ne remonte. */
  async function broadcastLobby(sessionId: string, meta: SessionMeta): Promise<void> {
    meta.lastLobbyBroadcastAt = Date.now()
    try {
      if (sessionMetaByEngineId.get(sessionId) !== meta) return
      const session = await engine.peekSession(sessionId)
      const players = playersPayload(session)
      io.to(viewersRoomName(sessionId)).emit('lobby:update', { players })
      io.to(roomName(sessionId)).emit('lobby:count', { count: players.filter((p) => p.connected !== false).length })
    } catch {
      // Session évincée entre-temps : plus personne à prévenir.
    }
  }

  /** Diffusion coalescée du lobby (limitation en tête et en queue, par session) : si rien n'est en
   * attente et que la dernière diffusion date d'au moins `LOBBY_BROADCAST_INTERVAL_MS`, on diffuse
   * tout de suite (une arrivée isolée se voit sans délai) ; sinon on planifie une seule diffusion à
   * `lastLobbyBroadcastAt + LOBBY_BROADCAST_INTERVAL_MS`, qui relira la session à l'échéance. Jamais
   * plus d'un minuteur en attente par session : les arrivées suivantes de la rafale s'y greffent. */
  function scheduleLobbyBroadcast(sessionId: string): void {
    const meta = sessionMetaByEngineId.get(sessionId)
    if (!meta || meta.lobbyBroadcastTimeout) return
    const delay = meta.lastLobbyBroadcastAt + lobbyBroadcastIntervalMs - Date.now()
    if (delay <= 0) {
      void broadcastLobby(sessionId, meta)
      return
    }
    const timer = setTimeout(() => {
      meta.lobbyBroadcastTimeout = null
      void broadcastLobby(sessionId, meta)
    }, delay)
    // `.unref()` : cohérent avec les autres minuteurs de session.
    timer.unref()
    meta.lobbyBroadcastTimeout = timer
  }

  /** Annule la diffusion différée du nuage (`SessionMeta.wordcloudBroadcastTimeout`), s'il y en a
   * une en attente. Sûr à appeler inconditionnellement (no-op si `null`). */
  function clearWordcloudBroadcastTimeout(meta: SessionMeta): void {
    if (meta.wordcloudBroadcastTimeout) {
      clearTimeout(meta.wordcloudBroadcastTimeout)
      meta.wordcloudBroadcastTimeout = null
    }
  }

  /** Diffuse le nuage agrégé de la question courante à l'hôte et au grand écran seulement (room
   * `viewers:<id>`), jamais aux téléphones. Relit la session au moment de partir pour refléter
   * l'état final d'une rafale. Rien n'est émis si la session a disparu ou si la question courante
   * n'est plus un nuage (question suivante démarrée entre-temps). */
  async function broadcastWordcloud(sessionId: string, meta: SessionMeta): Promise<void> {
    meta.lastWordcloudBroadcastAt = Date.now()
    try {
      if (sessionMetaByEngineId.get(sessionId) !== meta) return
      const session = await engine.peekSession(sessionId)
      const view = engine.wordcloudView(session)
      if (view) io.to(viewersRoomName(sessionId)).emit('wordcloud:update', view)
    } catch {
      // Session évincée entre-temps : plus personne à prévenir.
    }
  }

  /** Diffusion cadencée du nuage (même principe que `scheduleLobbyBroadcast`) : émission immédiate
   * si la dernière date d'au moins `WORDCLOUD_BROADCAST_INTERVAL_MS`, sinon une seule émission
   * planifiée à l'échéance. Les envois suivants de la rafale se greffent sur ce minuteur. */
  function scheduleWordcloudBroadcast(sessionId: string, meta: SessionMeta): void {
    if (meta.wordcloudBroadcastTimeout) return
    const delay = meta.lastWordcloudBroadcastAt + WORDCLOUD_BROADCAST_INTERVAL_MS - Date.now()
    if (delay <= 0) {
      void broadcastWordcloud(sessionId, meta)
      return
    }
    const timer = setTimeout(() => {
      meta.wordcloudBroadcastTimeout = null
      void broadcastWordcloud(sessionId, meta)
    }, delay)
    timer.unref()
    meta.wordcloudBroadcastTimeout = timer
  }

  /** Annule toute diffusion du nuage en attente et diffuse tout de suite (retrait d'un mot par
   * l'hôte, révélation). L'émission est partie quand la promesse se résout. */
  async function flushWordcloudBroadcast(sessionId: string, meta: SessionMeta): Promise<void> {
    clearWordcloudBroadcastTimeout(meta)
    await broadcastWordcloud(sessionId, meta)
  }

  /** Rejoue le nuage courant à UN SEUL socket hôte ou grand écran (reconnexion). Jamais appelé pour
   * un joueur : les téléphones ne reçoivent pas le nuage (d'où son absence de
   * `replayCurrentQuestionTo`, partagé avec eux). */
  function replayWordcloudTo(socket: Socket, session: GameSession): void {
    if (session.phase !== 'question' && session.phase !== 'reveal' && session.phase !== 'scoreboard') return
    const view = engine.wordcloudView(session)
    if (view) socket.emit('wordcloud:update', view)
  }

  /** Charge de `podium`, partagée par `doAdvance` et `emitReconnectSnapshot`. Un quiz sans aucune
   * question notée (sondages, nuages de mots) finit sans classement : `top` vide, et
   * `hasScoredQuestions` dit aux clients d'afficher « Merci pour vos réponses ». Un quiz mixte
   * garde son podium, même si toutes les questions notées ont donné 0 point. */
  function podiumPayload(
    session: GameSession,
    meta: SessionMeta | undefined,
  ): {
    top: ReturnType<Engine['ranking']>
    ranking?: ReturnType<Engine['ranking']>
    sources: ContentSource[]
    hasScoredQuestions: boolean
  } {
    const hasScoredQuestions = engine.hasScoredQuestions(session)
    // `ranking` complet (moteur, donc sans joueur exclu) : les écrans s'en servent pour le
    // « Classement complet » au lieu du dernier `scoreboard`, qui peut contenir un exclu.
    const ranking = hasScoredQuestions ? engine.ranking(session) : undefined
    return {
      top: ranking?.slice(0, 3) ?? [],
      ranking,
      sources: meta?.sources ?? [],
      hasScoredQuestions,
    }
  }

  /** Rejoue la révélation d'une question NON notée (sondage, nuage) à UN SEUL socket d'affichage
   * (grand écran) qui rejoint ou se reconnecte après la clôture : pour ces questions, l'écran reste
   * sur la révélation (répartition, nuage) et n'affiche jamais le classement, alors que la session
   * est déjà en phase 'scoreboard' côté serveur. Sans ce rejeu, il resterait vide jusqu'à la
   * question suivante. No-op pour une question notée ou hors 'reveal'/'scoreboard'. Rend `true`
   * quand le rejeu a eu lieu (le nuage y est déjà rejoué, l'appelant n'a pas à le refaire).
   * Anti-triche : `questionResult` n'est lu qu'après `reveal()` (phases testées ici), comme ailleurs. */
  function replayUnscoredRevealTo(socket: Socket, session: GameSession): boolean {
    if (session.phase !== 'reveal' && session.phase !== 'scoreboard') return false
    if (engine.isCurrentQuestionScored(session)) return false
    const view = engine.playerQuestionView(session)
    if (view) socket.emit('question:show', view)
    replayWordcloudTo(socket, session)
    socket.emit('question:reveal', engine.questionResult(session))
    return true
  }

  /** Planifie l'avance automatique de l'étape classement vers la suite (question suivante ou
   * podium) à l'échéance de `meta.autoAdvanceDelayMs`, puis diffuse `auto:advance { nextAt }` à
   * toute la room pour le compte à rebours CLIENT (même esprit que `timer` : le serveur est seul
   * maître de la bascule, le client ne fait que la refléter). No-op si le mode auto est désactivé,
   * ou si la session est déjà au podium / encore en lobby (rien à enchaîner). Annule d'abord tout
   * minuteur d'avance encore en attente (une seule avance par étape). À l'échéance, délègue à
   * `doAdvance`, qui re-nettoie ce minuteur et route vers question suivante/podium. */
  function scheduleAutoAdvance(sessionId: string, meta: SessionMeta, session: GameSession): void {
    clearAdvanceTimeout(meta)
    if (!meta.autoAdvance) return
    if (session.phase === 'podium' || session.phase === 'lobby') return
    const nextAt = Date.now() + meta.autoAdvanceDelayMs
    meta.advanceNextAt = nextAt
    io.to(roomName(sessionId)).emit('auto:advance', { nextAt })
    const timer = setTimeout(() => {
      void doAdvance(sessionId, meta).catch(() => {})
    }, meta.autoAdvanceDelayMs)
    // `.unref()` : ce minuteur ne doit jamais, à lui seul, maintenir le process en vie (cohérent
    // avec `readingTimeout`/`questionTimeout`) — le serveur HTTP s'en charge déjà.
    timer.unref()
    meta.advanceTimeout = timer
  }

  /** Avance la session au-delà de l'étape classement : vers la question suivante (`startQuestionFlow`)
   * ou, s'il n'en reste plus, vers le podium (fin de partie, statut DB + nettoyage `engine_state` +
   * éviction mémoire différée). Corps commun de `host:next` (geste manuel) et de l'avance
   * automatique planifiée par `scheduleAutoAdvance`. Nettoie d'abord TOUS les minuteurs (lecture,
   * question, avance) pour ne jamais laisser une transition fantôme traîner. Filet de sécurité
   * repris de l'ancien `host:next` : si la phase est encore 'question' (host:next anticipé, sans
   * révélation préalable), on révèle d'abord en interne (crédit + persistance + diffusion) pour ne
   * pas perdre silencieusement les points de la manche — via `doRevealBySession(..., false)` : pas
   * de re-planification d'avance, puisqu'on avance justement là tout de suite. */
  async function doAdvance(sessionId: string, meta: SessionMeta): Promise<GameSession> {
    clearReadingTimeout(meta)
    clearQuestionTimeout(meta)
    clearAdvanceTimeout(meta)
    const current = await engine.getSession(sessionId)
    if (current.phase === 'question') {
      await doRevealBySession(sessionId, meta, false)
    }
    if (current.currentIndex + 1 < current.questions.length) {
      return startQuestionFlow(sessionId, meta)
    }
    const session = await engine.podium(sessionId)
    // Une auto-révélation (jamais attendue par l'hôte) peut encore écrire la dernière manche : le
    // podium n'est annoncé qu'une fois les scores en base, cohérents avec le classement affiché.
    await Promise.allSettled(meta.roundWrites.values())
    await withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) =>
      setSessionStatus(scope.db, meta.dbSessionId, 'ended'),
    )
    // Nettoyage `engine_state` passé le podium — cohérent avec l'ancien host:next (le rapport final
    // reste lisible via session_player/answer_record).
    await clearEngineState(systemDb, meta.dbSessionId)
    io.to(roomName(sessionId)).emit('podium', podiumPayload(session, meta))
    // Éviction mémoire différée (P1-6) : fenêtre de grâce pour une reconnexion au podium.
    setTimeout(() => {
      void evictSessionMemory(sessionId, meta)
    }, PODIUM_EVICTION_DELAY).unref()
    return session
  }

  /** Planifie l'auto-révélation autoritative de la manche 'question' courante à l'expiration de
   * `timeLimit` (P1-7). No-op hors phase 'question'. À l'échéance, révèle via `doRevealBySession`,
   * en réutilisant la MÊME garde d'émission unique (`autoRevealedRounds`) que l'auto-révélation
   * « tous ont répondu » (`player:answer`) — pas de double `question:reveal` si les deux se
   * déclenchent. `doRevealBySession` appelle `clearQuestionTimeout` en premier : une révélation
   * manuelle (host:reveal) annule donc ce minuteur avant qu'il ne fire. */
  function scheduleQuestionTimeout(sessionId: string, meta: SessionMeta, session: GameSession): void {
    clearQuestionTimeout(meta)
    if (session.phase !== 'question') return
    const scheduledIndex = session.currentIndex
    const question = session.questions[scheduledIndex]
    if (!question) return
    const timer = setTimeout(() => {
      void (async () => {
        const current = await engine.getSession(sessionId).catch(() => null)
        if (!current || current.phase !== 'question') return
        // Défense en profondeur (P1-7-2) : ne révèle QUE la manche pour laquelle ce minuteur a été
        // planifié — un minuteur périmé (discipline slot-unique déjà cassée par un refactor futur)
        // ne peut pas révéler prématurément la manche courante.
        if (current.currentIndex !== scheduledIndex) return
        // Re-vérifiée APRÈS l'await : si une révélation (auto « tous ont répondu », ou manuelle
        // reveal/skip qui pose désormais ce drapeau — P1-7-1) a résolu la manche pendant le gap
        // async, on n'émet rien (anti-double-reveal, et respect du contrat « skip ne révèle pas »).
        if (meta.autoRevealedRounds.has(current.currentIndex)) return
        meta.autoRevealedRounds.add(current.currentIndex)
        await doRevealBySession(sessionId, meta)
      })().catch(() => {})
    }, question.timeLimit * 1000)
    // `.unref()` : ce minuteur ne doit jamais, à lui seul, maintenir le process en vie (le serveur
    // HTTP le fait déjà). Évite aussi de retarder l'arrêt en test (timeLimit par défaut = 20 s).
    timer.unref()
    meta.questionTimeout = timer
  }

  /** Éviction mémoire d'une partie TERMINÉE (P1-6) : libère toutes les structures locales à la
   * passerelle (metas, index PIN, sockets actifs des joueurs, tokens d'écran) ET le cache du
   * store (via `engine.evictSession`). Idempotent : sûr à appeler même si déjà évincé. Ne touche
   * pas la DB (le rapport final reste lisible via session_player/answer_record). */
  async function evictSessionMemory(sessionId: string, meta: SessionMeta): Promise<void> {
    clearReadingTimeout(meta)
    clearQuestionTimeout(meta)
    clearAdvanceTimeout(meta)
    clearLobbyBroadcastTimeout(meta)
    clearWordcloudBroadcastTimeout(meta)
    for (const playerId of meta.playerDbIds.keys()) activeSocketIdByPlayerId.delete(playerId)
    for (const [token, sid] of screenTokenToSessionId) {
      if (sid === sessionId) {
        screenTokenToSessionId.delete(token)
        consumedScreenTokens.delete(token)
      }
    }
    // On ne supprime QUE les entrées PIN pointant ENCORE vers CETTE session : entre le podium
    // et l'éviction différée (+10 min), le PIN a pu être réattribué à une NOUVELLE partie live
    // (`generateUniquePin` ignore les sessions au podium + engine_state DB vidé) — supprimer par
    // `session.pin` sans ce garde casserait le mapping de cette autre partie (régression).
    for (const [pin, sid] of pinToSessionId) {
      if (sid === sessionId) pinToSessionId.delete(pin)
    }
    sessionMetaByEngineId.delete(sessionId)
    await engine.evictSession(sessionId).catch(() => {})
  }

  /** Réauth + résolution tenant/rôle/owner (début historique de `host:create`). */
  async function resolveHostContext(
    socket: Socket,
  ): Promise<{ userId: string; context: { tenantId: string; ownerId?: string } }> {
    const authSession = await auth.api.getSession({ headers: fromNodeHeaders(socket.handshake.headers) })
    if (!authSession?.user) throw new Error('authentification requise')

    // Résolution PRÉ-contexte via systemDb (détermine le tenant + le rôle → ownerId
    // role-aware : owner/admin peut lancer sur n'importe quel quiz du tenant, member sur les
    // siens — parité avec les routes HTTP). En mode multi, le workspace actif est porté par le
    // handshake socket (`io({ auth: { tenantId } })`, voir apps/web) — l'équivalent WS de
    // l'en-tête `x-tenant-id`. Sans ça, `resolveTenantId` lèverait « tenant explicite requis ».
    const explicitTenantId =
      typeof socket.handshake.auth?.tenantId === 'string' ? (socket.handshake.auth.tenantId as string) : undefined
    const tenantId = await resolveTenantId(systemDb, config, { userId: authSession.user.id, explicitTenantId })
    const role = (await getMembershipRole(systemDb, authSession.user.id, tenantId)) ?? 'member'
    const ownerId = hasPermission(role, 'content:access-all') ? undefined : authSession.user.id
    const context = { tenantId, ownerId }
    return { userId: authSession.user.id, context }
  }

  /** Crée la partie (questions sous RLS, PIN, ligne DB, session moteur, meta, maps). Ne touche NI `socket.data` NI les rooms. */
  async function buildHostedSession(
    userId: string,
    context: { tenantId: string; ownerId?: string },
    quizId: string,
  ): Promise<{ session: GameSession }> {
    const { tenantId } = context
    // Lecture du quiz sous RLS (appDb + GUC) : un quiz d'un autre tenant n'existe pas pour ce
    // contexte → « quiz introuvable ». Un quiz archivé n'est plus lançable (création comme
    // relance) ; les parties déjà en cours ne repassent pas par ici et restent jouables.
    const questionRows = await withTenantTx(appDb, context, async (scope) => {
      const quiz = await getQuiz(scope, quizId)
      if (!quiz) return null
      if (quiz.archivedAt) throw new Error('Ce quiz est archivé : restaurez-le pour lancer une partie.')
      return listQuestions(scope, quizId)
    })
    if (!questionRows) throw new Error('quiz introuvable')

    const questions = questionRows.map(toEngineQuestion)

    // DB d'abord (Task 2, unification moteur↔DB) : la ligne `game_session` doit exister
    // AVANT le premier `engine.createSession` (qui appelle `store.save` — Task 3/4, le store
    // persistant fait `UPDATE game_session SET engine_state=… WHERE id = session.id`, un
    // UPDATE sur une ligne inexistante ne persisterait rien). Il faut donc connaître le PIN
    // (généré par le moteur) AVANT de créer la ligne DB — d'où `generateUniquePin()`.
    const pin = await engine.generateUniquePin()
    // Création sous RLS (appDb + GUC) : WITH CHECK garantit tenant_id = contexte.
    const dbSession = await withTenantTx(appDb, context, (scope) =>
      createGameSession(scope, { quizId, hostId: userId, pin }),
    )
    if (!dbSession) throw new Error('création de la session impossible')

    // L'id `game_session` DB devient l'id moteur — UN SEUL id partout (plus de map de
    // correspondance inverse entre les deux, désormais inutile).
    const session = await engine.createSession({
      id: dbSession.id,
      pin,
      quizId,
      tenantId,
      hostId: userId,
      questions,
    })

    sessionMetaByEngineId.set(session.id, {
      dbSessionId: dbSession.id,
      tenantId,
      sources: distinctSources(questionRows),
      playerDbIds: new Map(),
      revealedRounds: new Set(),
      roundWrites: new Map(),
      autoRevealedRounds: new Set(),
      statusActiveSet: false,
      readingTimeout: null,
      questionTimeout: null,
      autoAdvance: DEFAULT_AUTO_ADVANCE,
      autoAdvanceDelayMs: DEFAULT_AUTO_ADVANCE_DELAY_MS,
      advanceTimeout: null,
      advanceNextAt: null,
      seatsTaken: 0,
      lobbyBroadcastTimeout: null,
      lastLobbyBroadcastAt: 0,
      wordcloudBroadcastTimeout: null,
      lastWordcloudBroadcastAt: 0,
    })
    pinToSessionId.set(session.pin, session.id)
    return { session }
  }

  /** Exige que `userId` soit encore membre de l'espace `tenantId`. Partagée par `requireLiveHost`
   * et `host:reconnect` : un membre retiré de l'espace perd le contrôle de ses parties en cours. */
  async function assertHostMembership(userId: string, tenantId: string): Promise<void> {
    const role = await getMembershipRole(systemDb, userId, tenantId)
    if (!role) throw new Error(HOST_REVOKED_MESSAGE)
  }

  /** Garde de toutes les commandes hôte. Le rôle posé sur `socket.data` ne suffit pas : la session
   * Better Auth du handshake est relue à chaque action (un sign-out ou une expiration retire la
   * main), elle doit appartenir à l'hôte de la partie, qui doit encore être membre de l'espace.
   * Pas de cache : les événements d'hôte sont rares (quelques-uns par minute). */
  async function requireLiveHost(socket: Socket): Promise<{ sessionId: string; meta: SessionMeta }> {
    const data = socket.data as SocketData
    if (data.role !== 'host' || !data.sessionId) throw new Error("action réservée à l'hôte de la session")
    const sessionId = data.sessionId
    const meta = sessionMetaByEngineId.get(sessionId)
    if (!meta) throw new Error('session introuvable')
    try {
      const authSession = await auth.api.getSession({ headers: fromNodeHeaders(socket.handshake.headers) })
      if (!authSession?.user) throw new Error(HOST_REVOKED_MESSAGE)
      const session = await engine.getSession(sessionId)
      if (session.hostId !== authSession.user.id) throw new Error(HOST_REVOKED_MESSAGE)
      await assertHostMembership(authSession.user.id, meta.tenantId)
    } catch (e) {
      // Autorité révoquée : la socket perd aussi son rôle et ses rooms, sinon elle continuerait
      // de recevoir les diffusions (lobby, progression) réservées à l'hôte.
      if (message(e) === HOST_REVOKED_MESSAGE) await revokeHostSocket(socket, sessionId)
      throw e
    }
    return { sessionId, meta }
  }

  /** Retire à une socket hôte révoquée son rôle et ses rooms de session. */
  async function revokeHostSocket(socket: Socket, sessionId: string): Promise<void> {
    const data = socket.data as SocketData
    data.role = undefined
    data.sessionId = undefined
    await socket.leave(roomName(sessionId))
    await socket.leave(viewersRoomName(sessionId))
  }

  /** Écrit les answer_record d'UNE manche donnée (`idx`), sans garde `revealedRounds`. Idempotent
   * au niveau DB (`recordAnswer` = ON CONFLICT DO NOTHING). Utilisé par `persistRound` (flux live)
   * ET par la cicatrisation au redémarrage (P1-8). */
  async function persistRoundAnswers(meta: SessionMeta, session: GameSession, idx: number): Promise<void> {
    const question = session.questions[idx]
    if (!question) return
    const roundAnswers = session.answers[idx] ?? {}
    // RLS : écritures answer_record scopées au tenant de la session (contexte connu via meta).
    await withTenantTx(appDb, { tenantId: meta.tenantId }, async (scope) => {
      for (const [enginePlayerId, submitted] of Object.entries(roundAnswers)) {
        const dbPlayerId = meta.playerDbIds.get(enginePlayerId)
        if (!dbPlayerId) continue
        await recordAnswer(scope.db, {
          sessionId: meta.dbSessionId,
          questionId: question.id,
          playerId: dbPlayerId,
          answer: submitted.answer,
          timeMs: submitted.timeMs,
          isCorrect: submitted.correct,
          points: submitted.points,
        })
      }
    })
  }

  /** Persiste les scores totaux de tous les joueurs (idempotent : simple overwrite). */
  async function persistPlayerScores(meta: SessionMeta, session: GameSession): Promise<void> {
    // RLS : écritures session_player scopées au tenant de la session.
    await withTenantTx(appDb, { tenantId: meta.tenantId }, async (scope) => {
      for (const player of Object.values(session.players)) {
        const dbPlayerId = meta.playerDbIds.get(player.id)
        if (!dbPlayerId) continue
        await setPlayerScore(scope.db, dbPlayerId, player.score)
      }
    })
  }

  /** Persiste les réponses + scores de la manche EN COURS (session.currentIndex), après reveal().
   * Garde `meta.revealedRounds` : évite le travail redondant d'un reveal rejoué (host:reveal ou
   * host:skip) sur la même manche. La correction de la fenêtre de crash (P1-8) ne repose PLUS sur
   * cette garde mémoire (qui, reconstruite depuis `credited` au boot, laissait échapper une manche
   * créditée-mais-non-persistée) mais sur l'idempotence DB + la cicatrisation au redémarrage. */
  async function persistRound(meta: SessionMeta, session: GameSession): Promise<void> {
    const idx = session.currentIndex
    const question = session.questions[idx]
    if (!question) return
    const pending = meta.roundWrites.get(idx)
    if (pending) return pending
    if (meta.revealedRounds.has(idx)) return
    meta.revealedRounds.add(idx)
    const write = (async () => {
      await persistRoundAnswers(meta, session, idx)
      await persistPlayerScores(meta, session)
    })()
    meta.roundWrites.set(idx, write)
    try {
      await write
    } finally {
      meta.roundWrites.delete(idx)
    }
  }

  /** Corps commun de révélation (crédit + persistance + diffusion `question:reveal`/`scoreboard`),
   * factorisé pour être appelé aussi bien par `host:reveal` (via `doReveal`) que par
   * l'auto-révélation serveur déclenchée depuis `player:answer` quand tous les joueurs connectés
   * ont répondu. Idempotent (comme avant) via `engine.reveal`/`persistRound`.
   *
   * Ordre IMPORTANT (revu pour l'auto-révélation) : `persistRound` (écritures DB, potentiellement
   * plusieurs allers-retours lents) est appelé EN DERNIER, après `engine.scoreboard()` et ses
   * deux diffusions. Sur le chemin hôte (toujours entièrement `await`-é de façon séquentielle par
   * un seul socket), l'ordre relatif était invisible. Mais l'auto-révélation (déclenchée depuis
   * `player:answer`, jamais attendue par aucun client — voir plus bas) est un chemin best-effort
   * qui peut s'exécuter en parallèle du jeu qui continue d'avancer : si `persistRound` (lent)
   * s'exécutait AVANT `engine.scoreboard(sessionId)`, celui-ci — qui relit l'état COURANT de la
   * session par `sessionId`, pas un instantané figé — risquerait de faire `phase = 'scoreboard'`
   * sur la MANCHE SUIVANTE (déjà démarrée entre-temps par l'hôte) si elle a eu le temps de
   * commencer pendant l'attente DB, corrompant sa phase (`engine.reveal()`/`questionResult`,
   * eux, restent sûrs : ils opèrent sur `revealed`, un instantané renvoyé par le store — qui clone
   * profondément l'état, voir `MemorySessionStore` — donc jamais muté après coup). En plaçant
   * `persistRound` après les deux mutations+diffusions, aucune opération lente (I/O réel) ne
   * s'intercale plus entre `engine.reveal()` et `engine.scoreboard()` : les deux s'exécutent
   * l'un après l'autre sans qu'un autre événement socket (ex. host:next) ne puisse s'intercaler. */
  async function doRevealBySession(sessionId: string, meta: SessionMeta, scheduleAuto = true): Promise<void> {
    // Annulation : une révélation manuelle (ou auto-révélation) qui arrive PENDANT la phase
    // 'reading' (ex. host:reveal anticipé — voir le garde dans le handler `host:reveal`, qui
    // laisse passer 'reading' comme n'importe quelle phase hors 'lobby') doit annuler le minuteur
    // planifié par `startQuestionFlow` — sinon celui-ci se déclencherait une seconde fois plus
    // tard (révélation fantôme) sur une manche déjà avancée par ce chemin-ci. Idem pour le
    // minuteur autoritatif de fin de question (P1-7) : une révélation (manuelle ou « tous ont
    // répondu ») annule l'auto-révélation planifiée pour cette manche.
    clearReadingTimeout(meta)
    clearQuestionTimeout(meta)
    // Persistance en DERNIER (cf. commentaire ci-dessous). NOTE (P1-8) : la fenêtre de crash entre
    // `engine.reveal()` (crédite + persiste `engine_state`) et `persistRound` (écrit
    // `answer_record`) est désormais CICATRISÉE au redémarrage (réhydratation ré-persiste
    // idempotemment les manches créditées — voir `rehydrateActiveSessions`). Historique conservé :
    // avant P1-8, un crash pile ici ferait, au redémarrage, dériver `revealedRounds` de `credited`
    // → `persistRound` sauterait
    // cette manche → le DÉTAIL par-question du RAPPORT DB manquerait pour elle. Le jeu live et le
    // CLASSEMENT restent corrects (scores dans `engine_state` ; `total_score` se rattrape à la
    // manche suivante). On garde délibérément les écritures DB EN DERNIER pour éviter un bug pire
    // (persistRound entre reveal() et scoreboard() pourrait tamponner `phase='scoreboard'` sur la
    // manche SUIVANTE). Durcissement possible (suivi) : écrire answer_record avant de créditer, ou
    // un flag « persisté » distinct de `credited`.
    const revealed = await engine.reveal(sessionId)
    // Marque la manche comme résolue AVANT d'émettre (P1-7-1) : un minuteur d'auto-révélation
    // qui aurait fire en parallèle (course à la frontière de `timeLimit`) re-teste
    // `autoRevealedRounds.has(currentIndex)` après son `await` et n'émettra donc pas un second
    // `question:reveal`. Set idempotent : le chemin timer/auto l'a déjà ajouté avant d'appeler.
    meta.autoRevealedRounds.add(revealed.currentIndex)

    // Anti-triche : `questionResult` (qui contient la bonne réponse) n'est calculé qu'ICI,
    // strictement après engine.reveal() — jamais avant, jamais pour `question:show`.
    const result = engine.questionResult(revealed)
    // Nuage : l'écran et l'hôte reçoivent l'état final juste avant de le figer. Émission
    // synchrone depuis l'instantané `revealed` (équivalent de `flushWordcloudBroadcast`, sans
    // relecture) : aucun `await` ne s'intercale entre `engine.reveal()` et `engine.scoreboard()`.
    const finalCloud = engine.wordcloudView(revealed)
    if (finalCloud) {
      clearWordcloudBroadcastTimeout(meta)
      meta.lastWordcloudBroadcastAt = Date.now()
      io.to(viewersRoomName(sessionId)).emit('wordcloud:update', finalCloud)
    }
    io.to(roomName(sessionId)).emit('question:reveal', result)

    const scored = await engine.scoreboard(sessionId)
    const ranking = engine.ranking(scored)
    io.to(roomName(sessionId)).emit('scoreboard', { ranking })

    // Enchaînement automatique : on vient d'entrer dans l'étape classement — si le mode auto est
    // actif, planifie la bascule vers la suite. Désactivé (`scheduleAuto === false`) quand ce
    // reveal n'est qu'un préalable à `doAdvance` (host:next anticipé), qui avance aussitôt.
    if (scheduleAuto) scheduleAutoAdvance(sessionId, meta, scored)

    await persistRound(meta, revealed)
  }

  /** Auto-révélation serveur « tous les joueurs connectés ont répondu » : révèle sans attendre
   * l'hôte ni le timer. Appelée après une réponse acceptée (`player:answer`) ET après une exclusion
   * en phase 'question' (`host:kick` : retirer le dernier joueur sans réponse complète la manche).
   * Idempotente via `meta.autoRevealedRounds` (garde posée AVANT l'`await` de révélation : deux
   * appels concurrents sur la même manche n'émettent qu'un seul `question:reveal`/`scoreboard`).
   * Les appelants la traitent en best-effort (erreur avalée, l'hôte peut toujours révéler). */
  async function maybeAutoReveal(sessionId: string, meta: SessionMeta): Promise<void> {
    const session = await engine.peekSession(sessionId)
    if (engine.allConnectedAnswered(session) && !meta.autoRevealedRounds.has(session.currentIndex)) {
      meta.autoRevealedRounds.add(session.currentIndex)
      await doRevealBySession(sessionId, meta)
    }
  }

  /** `host:reveal` : révèle la bonne réponse (`question:reveal`) puis le classement cumulé
   * (`scoreboard`). Crédite les points de la manche EXACTEMENT une fois (idempotent via
   * `engine.reveal`/`persistRound`, voir leurs commentaires). */
  async function doReveal(socket: Socket, ack?: (res: unknown) => void): Promise<void> {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const { sessionId, meta } = await requireLiveHost(socket)
      await doRevealBySession(sessionId, meta)
      reply({ ok: true })
    } catch (e) {
      reply({ error: message(e) })
    }
  }

  /** `host:skip` (hardening, Task 4 — corrige l'ancien alias trompeur de `doReveal`) : avance
   * au-delà de la question en cours SANS jamais émettre `question:reveal` (la bonne réponse ne
   * doit JAMAIS être diffusée pour un "skip" — c'est précisément ce qui distingue un skip d'un
   * reveal). Décision produit (documentée ici, cf. backlog) : les réponses déjà données par les
   * joueurs sont quand même CRÉDITÉES et PERSISTÉES — ils ont répondu, ce n'est pas de leur
   * faute si l'hôte écourte la manche — seule la RÉVÉLATION de la bonne réponse est sautée.
   * Réutilise `engine.reveal()` pour le crédit (idempotent via `credited[]`) et `persistRound`
   * pour la persistance (idempotent via `revealedRounds`), mais s'arrête là : aucun
   * `questionResult`/`question:reveal` n'est jamais calculé ni émis dans ce chemin. Sur une
   * question notée, émet ensuite `scoreboard` (classement cumulé, sans contenu de réponse — pas
   * une fuite anti-triche) pour que l'hôte/l'écran voient la partie avancer. Sur une question non
   * notée (sondage, nuage), il n'y a pas d'étape classement : enchaîne directement via
   * `doAdvance` (question suivante ou podium). Refusé en lobby et au podium (rien à passer). */
  async function doSkip(socket: Socket, ack?: (res: unknown) => void): Promise<void> {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const { sessionId, meta } = await requireLiveHost(socket)
      const current = await engine.getSession(sessionId)
      if (current.phase === 'lobby') {
        throw new Error('host:skip : aucune question active (session encore en lobby)')
      }
      if (current.phase === 'podium') {
        throw new Error('host:skip : aucune question active (partie terminée, podium)')
      }
      // Annulation : voir le commentaire équivalent dans `doRevealBySession` — un host:skip
      // anticipé pendant 'reading'/'question' ne doit jamais laisser un minuteur planifié se
      // déclencher après coup.
      // Anti-triche (P1-7-1) : on MARQUE d'abord la manche comme résolue AVANT d'annuler le
      // minuteur. Si le minuteur d'auto-révélation venait juste de fire (course à la frontière
      // exacte de `timeLimit`, où `clearQuestionTimeout` arrive trop tard), sa callback re-teste
      // `autoRevealedRounds.has(currentIndex)` APRÈS son `await` et bat donc en retraite sans
      // émettre `question:reveal` — le contrat « skip ne révèle JAMAIS la réponse » est préservé.
      meta.autoRevealedRounds.add(current.currentIndex)
      clearReadingTimeout(meta)
      clearQuestionTimeout(meta)
      // Une avance automatique planifiée (par une auto-révélation concurrente) ne doit pas se
      // déclencher pendant les `await` ci-dessous et faire avancer la session sous nos pieds.
      clearAdvanceTimeout(meta)

      const revealed = await engine.reveal(sessionId) // crédite uniquement — PAS de question:reveal
      await persistRound(meta, revealed)

      // Course : pendant les `await` ci-dessus, une transition concurrente (avance automatique
      // planifiée juste avant notre `clearAdvanceTimeout`, host:next) a pu déjà quitter la manche
      // lue au départ. Dans ce cas le skip est sans objet : on n'avance PAS une seconde fois (ce
      // qui révélerait ou sauterait la question N+1).
      const after = await engine.getSession(sessionId)
      if (after.currentIndex !== current.currentIndex || after.phase === 'podium') {
        reply({ ok: true })
        return
      }

      // Question non notée (sondage, nuage) : pas d'étape classement à montrer, « Passer » enchaîne
      // directement sur la suite (question suivante, ou fin de partie). `doAdvance` re-nettoie tous
      // les minuteurs et ne révèle rien : la phase n'est plus 'question' après `engine.reveal()`.
      if (!engine.isCurrentQuestionScored(revealed)) {
        await doAdvance(sessionId, meta)
        reply({ ok: true })
        return
      }

      const scored = await engine.scoreboard(sessionId)
      const ranking = engine.ranking(scored)
      io.to(roomName(sessionId)).emit('scoreboard', { ranking })

      // Même enchaînement automatique qu'après une révélation : « Passer » amène aussi à l'étape
      // classement, qui doit avancer seule si le mode auto est actif.
      scheduleAutoAdvance(sessionId, meta, scored)

      reply({ ok: true })
    } catch (e) {
      reply({ error: message(e) })
    }
  }

  /** Payload `timer` : chrono MESURÉ (valeur unique au démarrage de la question, jamais un flux
   * par seconde) — `timeLimit` (secondes, pour dimensionner le compte à rebours côté client) +
   * `startedAt` (horodatage serveur de `questionStartedAt`, pour resynchroniser un client qui
   * rejoint/rafraîchit en cours de question). Ne contient aucun contenu de réponse. `null` si
   * aucune question courante (ex. session encore en lobby). */
  function timerPayload(session: GameSession): { timeLimit: number; startedAt: number | null } | null {
    const question = session.questions[session.currentIndex]
    if (!question) return null
    return { timeLimit: question.timeLimit, startedAt: session.questionStartedAt }
  }

  /** Diffuse `timer` à TOUTE la room (host:start / host:next qui démarre une question). */
  function emitTimer(sessionId: string, session: GameSession): void {
    const payload = timerPayload(session)
    if (payload) io.to(roomName(sessionId)).emit('timer', payload)
  }

  /** Démarre la question suivante (factorise `host:start` et `host:next` — appelé APRÈS que ces
   * derniers aient géré le reste de leur logique propre, ex. statut/ack/reveal préalable). Route
   * selon la phase posée par `engine.startQuestion` :
   * - `'reading'` (question avec `readingTime > 0`) : diffuse `question:reading` (énoncé SEUL,
   *   `readingView` — jamais les options, anti-triche) à TOUTE la room, puis planifie
   *   `meta.readingTimeout` : à échéance (readingTime secondes), révèle automatiquement via
   *   `revealAnswersFlow`. `clearReadingTimeout` d'abord par prudence (aucun minuteur ne devrait
   *   déjà courir ici — startQuestion vient de (re)partir d'une nouvelle manche — mais reste sûr).
   * - `'question'` (readingTime === 0) : flux ACTUEL inchangé — `question:show` (projection
   *   anti-triche) + `timer` immédiatement, à toute la room. */
  async function startQuestionFlow(sessionId: string, meta: SessionMeta): Promise<GameSession> {
    // Toute nouvelle question annule une éventuelle avance automatique encore planifiée pour
    // l'étape classement qu'on quitte (geste manuel « Suivant », ou avance déjà déclenchée) — sinon
    // elle se rejouerait plus tard sur une manche déjà avancée.
    clearAdvanceTimeout(meta)
    // Une diffusion du nuage encore en attente concerne la question qu'on quitte.
    clearWordcloudBroadcastTimeout(meta)
    const session = await engine.startQuestion(sessionId)
    if (session.phase === 'reading') {
      const view = engine.readingView(session)
      io.to(roomName(sessionId)).emit('question:reading', { ...view, startedAt: session.readingStartedAt })
      clearReadingTimeout(meta)
      meta.readingTimeout = setTimeout(() => {
        // `.catch` défensif comme les autres appels moteur fire-and-forget du fichier
        // (ex. setPlayerConnected au disconnect) : un rejet ici deviendrait sinon une
        // unhandled rejection (fatale sous Node) — non atteignable aujourd'hui (les
        // sessions ne sont jamais supprimées du store) mais cohérent avec le durcissement.
        revealAnswersFlow(sessionId, meta).catch(() => {})
      }, view.readingTime * 1000)
    } else {
      const view = engine.playerQuestionView(session)
      io.to(roomName(sessionId)).emit('question:show', view)
      emitTimer(sessionId, session)
      scheduleQuestionTimeout(sessionId, meta, session) // P1-7 : auto-révélation à expiration
    }
    return session
  }

  /** Fait sortir la session de la phase 'reading' vers 'question' (via `engine.revealAnswers`) et
   * diffuse `question:show` + `timer` à toute la room — déclenché soit par l'échéance du minuteur
   * planifié dans `startQuestionFlow`, soit potentiellement rejoué. Idempotent : `clearReadingTimeout`
   * d'abord (empêche une double échéance), puis garde `phase === 'question'` après l'appel moteur
   * (lui-même un no-op sûr hors phase 'reading', voir `engine.revealAnswers`) — si la phase a déjà
   * avancé autrement (ex. host:skip/host:next entre-temps a annulé CE minuteur, mais défense en
   * profondeur en cas d'appel concurrent), on n'émet rien de plus. */
  async function revealAnswersFlow(sessionId: string, meta: SessionMeta): Promise<void> {
    clearReadingTimeout(meta)
    const session = await engine.revealAnswers(sessionId)
    if (session.phase !== 'question') return
    const view = engine.playerQuestionView(session)
    io.to(roomName(sessionId)).emit('question:show', view)
    emitTimer(sessionId, session)
    scheduleQuestionTimeout(sessionId, meta, session) // P1-7 : idem après la phase de lecture
  }

  /** Libère le siège joueur que porte déjà `socket` (audit : une socket anonyme pouvait occuper
   * plusieurs sièges, et seul le dernier passait hors ligne au `disconnect` ; les autres restaient
   * `connected: true` et bloquaient l'auto-révélation). Appelée avant d'attribuer un nouveau siège
   * par `player:join` ou `player:reconnect`. La partie synchrone (rattachement de la socket, socket
   * active du joueur) s'exécute avant tout `await`, si bien qu'un appel non attendu suffit à
   * détacher la socket. Le joueur n'est marqué hors ligne que si cette socket est encore sa socket
   * active : une reconnexion sur une autre socket garde la main. Il reste dans la partie (score et
   * réponses conservés), récupérable par `player:reconnect`. */
  async function releasePlayerSeat(socket: Socket): Promise<void> {
    const data = socket.data as SocketData
    if (data.role !== 'player' || !data.sessionId || !data.playerId) return
    const { sessionId, playerId } = data
    data.role = undefined
    data.sessionId = undefined
    data.playerId = undefined
    const wasActive = activeSocketIdByPlayerId.get(playerId) === socket.id
    if (wasActive) activeSocketIdByPlayerId.delete(playerId)
    await socket.leave(roomName(sessionId))
    if (wasActive) await engine.setPlayerConnected(sessionId, playerId, false).catch(() => {})
    scheduleLobbyBroadcast(sessionId)
  }

  /** Refuse un siège joueur à une socket déjà hôte ou écran. */
  function assertNotHostOrScreen(socket: Socket): void {
    const role = (socket.data as SocketData).role
    if (role === 'host' || role === 'screen') {
      throw new Error('cette connexion est déjà utilisée par un hôte ou un écran')
    }
  }

  /** Rejoue la question en cours à UN SEUL socket qui vient de rejoindre/rafraîchir EN PLEINE
   * QUESTION (`player:join`/`screen:join` arrivant mid-question, symétrique du traitement déjà
   * fait par `player:reconnect`) — sans ça, un tel arrivant reste aveugle jusqu'à la question
   * suivante. Anti-triche : utilise EXCLUSIVEMENT `engine.playerQuestionView` (jamais le payload
   * brut ni `questionResult`), exactement comme `host:start`/`host:next`. Émis à CE socket
   * seulement (pas à la room — les autres l'ont déjà reçu). */
  function replayCurrentQuestionTo(socket: Socket, session: GameSession, alreadyAnswered?: boolean): void {
    if (session.phase !== 'question') return
    const view = engine.playerQuestionView(session)
    // `alreadyAnswered` (reconnexion d'un joueur seulement, jamais diffusé) voyage DANS le
    // `question:show` pour que le client n'ait aucune dépendance d'ordre avec l'acquittement.
    socket.emit('question:show', alreadyAnswered === undefined ? view : { ...view, alreadyAnswered })
    const timer = timerPayload(session)
    if (timer) socket.emit('timer', timer)
  }

  /** Snapshot d'état émis à UN SEUL socket qui vient de `host:reconnect` (Task 8) — sans lui, un
   * hôte qui reprend une partie live (reprise depuis Home, ou simple rechargement de page en
   * cours de partie) atterrit sur un écran vide : `HostLive` ne peuple joueurs/question/
   * classement QUE via ses abonnements `on(...)`, jamais par un état initial fabriqué. Réutilise
   * EXACTEMENT les mêmes événements que le reste de la passerelle (`lobby:update`,
   * `question:show`+`timer` via `replayCurrentQuestionTo`, `question:reveal`, `scoreboard`,
   * `podium`) — jamais un événement inédit que `HostLive` ne saurait pas gérer. Émis UNIQUEMENT
   * à `socket` (jamais `io.to(room)`) : les autres membres de la room ont déjà leur propre état,
   * à jour.
   *
   * Toujours précédé d'un `lobby:update` (liste des joueurs courante) quelle que soit la phase :
   * l'en-tête de `HostLive` (nombre de joueurs, connectés) et le compteur de réponses en phase
   * 'question' en dépendent tous deux, indépendamment de la phase affichée.
   *
   * Anti-triche : `engine.ranking(session)`/`engine.questionResult(session)` sont des
   * projections PURES (prennent `session` directement, aucun accès au store) — contrairement à
   * `engine.scoreboard(sessionId)`, qui RE-LIT la session par id et MUTE sa phase en 'scoreboard'
   * ; les appeler ici muterait à tort la phase réelle de la session pendant une simple
   * reconnexion (ex. un hôte qui reprend en pleine 'reveal' verrait la partie sauter directement
   * en 'scoreboard' pour tout le monde). `questionResult` (bonne réponse) n'est calculé QUE pour
   * les phases post-`reveal()` (reveal/scoreboard/podium) — jamais pour 'question', exactement
   * comme `doRevealBySession`. */
  function emitReconnectSnapshot(socket: Socket, session: GameSession): void {
    socket.emit('lobby:update', { players: playersPayload(session) })

    switch (session.phase) {
      case 'reading':
        // Reprise pendant la lecture (ex. hôte qui recharge la page) : le temps restant est
        // recalculé SERVEUR (`readingStartedAt`, jamais fabriqué par le client — cf. risques du
        // design). `readingStartedAt` n'est significatif QUE dans cette phase (il peut être
        // périmé/stale une fois passé en 'question' ou plus loin) — ne jamais le lire ailleurs.
        socket.emit('question:reading', {
          ...engine.readingView(session),
          startedAt: session.readingStartedAt,
        })
        break
      case 'question':
        replayCurrentQuestionTo(socket, session)
        replayWordcloudTo(socket, session)
        break
      case 'reveal': {
        const view = engine.playerQuestionView(session)
        if (view) socket.emit('question:show', view)
        replayWordcloudTo(socket, session)
        socket.emit('question:reveal', engine.questionResult(session))
        socket.emit('scoreboard', { ranking: engine.ranking(session) })
        break
      }
      case 'scoreboard':
        // Question non notée : l'hôte reste sur la révélation (répartition, nuage), jamais sur le
        // classement. Même rejeu que le cas 'reveal' ; `host:reconnect` annonce alors 'reveal'.
        if (!replayUnscoredRevealTo(socket, session)) replayWordcloudTo(socket, session)
        socket.emit('scoreboard', { ranking: engine.ranking(session) })
        break
      case 'podium':
        socket.emit('scoreboard', { ranking: engine.ranking(session) })
        socket.emit('podium', podiumPayload(session, sessionMetaByEngineId.get(session.id)))
        break
      case 'lobby':
      default:
        // Rien de plus : le `lobby:update` ci-dessus suffit déjà pour la phase 'lobby'.
        break
    }
  }

  /** Réhydratation au démarrage (Task 4) : après un redémarrage serveur, `sessionMetaByEngineId`/
   * `pinToSessionId` sont vides (état local à CET appel de `registerGameGateway`, voir plus haut)
   * même si l'état moteur a survécu en base (`PersistentSessionStore`, Task 3) — sans cette
   * fonction, `host:reconnect`/`player:reconnect` répondraient "session introuvable" sur une
   * partie pourtant reprenable. Ménage d'abord (`abandonStaleSessions`, sessions trop vieilles →
   * plus jamais reprenables), puis reconstruit la `SessionMeta` de chaque session candidate et
   * ré-ancre le chrono de sa phase courante à neuf (décision produit, voir le design : le chrono
   * ne reprend jamais là où il en était — il repart de zéro pour la durée COMPLÈTE de la phase).
   * Best-effort par session : une session individuellement corrompue/absente du store (ex. race
   * avec une écriture concurrente) ne doit jamais empêcher la reprise des autres. */
  async function rehydrateActiveSessions(maxAgeMs: number): Promise<void> {
    await abandonStaleSessions(systemDb, maxAgeMs)
    const rows = await listResumableSessions(systemDb, maxAgeMs)

    for (const row of rows) {
      try {
        // `engine.getSession` lit via le store persistant (Task 3) — qui charge `row.engineState`
        // depuis `engine_state` au premier accès (cache froid, process neuf) et le désérialise
        // (clés numériques `answers`/`credited` reconverties, voir `PersistentSessionStore`).
        const session = await engine.getSession(row.id)

        const dbPlayers = await listSessionPlayers(systemDb, row.id)
        const playerDbIds = new Map<string, string>()
        for (const enginePlayer of Object.values(session.players)) {
          const dbPlayer = dbPlayers.find((p) => p.joinToken === enginePlayer.joinToken)
          if (dbPlayer) playerDbIds.set(enginePlayer.id, dbPlayer.id)
        }

        // Les manches créditées (`session.credited`) sont déjà révélées/persistées avant le
        // redémarrage — `revealedRounds`/`autoRevealedRounds` doivent refléter ça pour ne jamais
        // re-créditer/re-diffuser une manche déjà close (idempotence, voir `persistRound`/
        // `doRevealBySession`).
        const revealedRounds = new Set(
          Object.entries(session.credited)
            .filter(([, credited]) => credited)
            .map(([idx]) => Number(idx)),
        )

        // Sources relues en base : elles ne font pas partie de l'état moteur persisté.
        const questionRows = await withTenantTx(appDb, { tenantId: session.tenantId }, (scope) =>
          listQuestions(scope, session.quizId),
        )

        const meta: SessionMeta = {
          dbSessionId: row.id,
          tenantId: session.tenantId,
          sources: distinctSources(questionRows ?? []),
          playerDbIds,
          revealedRounds,
          roundWrites: new Map(),
          autoRevealedRounds: new Set(revealedRounds),
          statusActiveSet: session.phase !== 'lobby',
          readingTimeout: null,
          questionTimeout: null,
          autoAdvance: DEFAULT_AUTO_ADVANCE,
          autoAdvanceDelayMs: DEFAULT_AUTO_ADVANCE_DELAY_MS,
          advanceTimeout: null,
          advanceNextAt: null,
          // Joueurs inscrits avant le redémarrage, déconnectés compris (ils peuvent revenir).
          seatsTaken: Object.keys(session.players).length,
          lobbyBroadcastTimeout: null,
          lastLobbyBroadcastAt: 0,
          wordcloudBroadcastTimeout: null,
          lastWordcloudBroadcastAt: 0,
        }
        sessionMetaByEngineId.set(session.id, meta)
        pinToSessionId.set(session.pin, row.id)

        // Cicatrisation de la fenêtre de crash reveal()/persistRound (P1-8) : une manche
        // CRÉDITÉE (dans `engine_state`) dont les `answer_record` n'ont pas été écrits (crash
        // serveur pile entre `engine.reveal()` et `persistRound`) verrait sinon son détail
        // par-question manquer du rapport DB À JAMAIS (`revealedRounds` reconstruit depuis
        // `credited` empêcherait toute ré-écriture). On ré-persiste donc ici, idempotemment
        // (`recordAnswer` = ON CONFLICT DO NOTHING), les réponses + scores de chaque manche
        // créditée. En régime nominal (déjà persisté), ce sont des no-op DB.
        for (const idx of revealedRounds) {
          await persistRoundAnswers(meta, session, idx).catch(() => {})
        }
        if (revealedRounds.size > 0) await persistPlayerScores(meta, session).catch(() => {})

        // Re-ancrage du chrono à neuf (voir la doc de `engine.reanchorTimer`) + reprogrammation/
        // ré-émission — SEULES les phases 'reading'/'question' portent un chrono actif ; les
        // autres ('lobby'/'reveal'/'scoreboard'/'podium') n'ont rien à reprogrammer, la
        // reconnexion (déjà en place, T8) suffira à renvoyer le bon snapshot.
        if (session.phase === 'reading') {
          const reanchored = await engine.reanchorTimer(row.id)
          const view = engine.readingView(reanchored)
          io.to(roomName(row.id)).emit('question:reading', { ...view, startedAt: reanchored.readingStartedAt })
          clearReadingTimeout(meta)
          meta.readingTimeout = setTimeout(() => {
            revealAnswersFlow(row.id, meta).catch(() => {})
          }, view.readingTime * 1000)
        } else if (session.phase === 'question') {
          const reanchored = await engine.reanchorTimer(row.id)
          const view = engine.playerQuestionView(reanchored)
          if (view) io.to(roomName(row.id)).emit('question:show', view)
          emitTimer(row.id, reanchored)
          // P1-7 : reprogramme l'auto-révélation autoritative pour le timeLimit COMPLET (chrono
          // ré-ancré à neuf, cohérent avec la phase 'reading' ci-dessus) — sans ça, une manche
          // reprise après redémarrage ne se fermerait jamais côté serveur si personne n'agit.
          scheduleQuestionTimeout(row.id, meta, reanchored)
        }
      } catch {
        // Session individuellement introuvable/corrompue (ex. `engine_state` absent malgré la
        // ligne `game_session` — course avec un `host:create` jamais allé jusqu'à son premier
        // `store.save`) : on l'ignore et on continue avec les autres candidates.
      }
    }
  }

  io.on('connection', (socket: Socket) => {
    // IP du client, vue à travers les seuls proxys de confiance (comme `request.ip` côté HTTP).
    // `clientIpFromRequest` peut ne rien renvoyer si la socket TCP n'a plus d'adresse : repli sur
    // l'adresse de la poignée de main, et sans adresse du tout, pas de budget pour cette socket.
    // Une IPv6 compte pour son /64 entier (un seul client en détient en général tout le préfixe).
    const clientIp = clientIpFromRequest(socket.request, trustProxy) || socket.handshake.address || undefined
    ;(socket.data as SocketData).pinFailureKey = clientIp ? pinFailureKey(clientIp) : undefined

    // Throttle par socket (P2, anti-DoS) : middleware exécuté avant CHAQUE handler d'event.
    // Au-delà de SOCKET_RATE_MAX events par fenêtre, l'event est rejeté (le handler n'est pas
    // appelé). `Date.now()` ici (couche passerelle, pas le moteur pur) est acceptable.
    socket.use((_event, next) => {
      const data = socket.data as SocketData
      const now = Date.now()
      if (data.rateWindowStart === undefined || now - data.rateWindowStart > SOCKET_RATE_WINDOW_MS) {
        data.rateWindowStart = now
        data.rateCount = 0
      }
      data.rateCount = (data.rateCount ?? 0) + 1
      if (data.rateCount > SOCKET_RATE_MAX) {
        next(new Error('trop de requêtes (throttle)'))
        return
      }
      next()
    })

    socket.on('host:create', async (payload: { quizId?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const quizId = payload?.quizId
        if (typeof quizId !== 'string' || !quizId) throw new Error('quizId requis')

        const { userId, context } = await resolveHostContext(socket)

        const { session } = await buildHostedSession(userId, context, quizId)

        // Une socket qui devient hôte rend d'abord le siège joueur qu'elle occupait.
        await releasePlayerSeat(socket)
        const data = socket.data as SocketData
        data.role = 'host'
        data.sessionId = session.id
        await socket.join(roomName(session.id))
        await socket.join(viewersRoomName(session.id))

        reply({ sessionId: session.id, pin: session.pin })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Relance depuis le podium : crée une NOUVELLE partie sur `quizId` et invite chaque participant
    // connecté (joueurs + grand écran) à la rejoindre via `session:relaunched`. Le serveur ne
    // déplace aucune socket ni aucune room : chaque client recharge et rejoint par son chemin de
    // reconnexion habituel. Les échecs pré-vol (podium, quiz, droits) surviennent AVANT toute
    // migration ; la migration elle-même est best-effort.
    socket.on('host:relaunch', async (payload: { quizId?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId: oldId } = await requireLiveHost(socket)
        const quizId = payload?.quizId
        if (typeof quizId !== 'string' || !quizId) throw new Error('quizId requis')

        const oldSession = await engine.getSession(oldId)
        if (oldSession.phase !== 'podium')
          throw new Error('host:relaunch : relance possible seulement en fin de partie')

        const { userId, context } = await resolveHostContext(socket)
        const { session: neu } = await buildHostedSession(userId, context, quizId)
        const newMeta = sessionMetaByEngineId.get(neu.id)!

        // Invariant : une relance engagée (nouvelle session créée) n'est jamais abandonnée.
        // Toute la migration est best-effort et ne doit pas atteindre le `catch` externe, sinon
        // l'hôte recevrait une erreur alors que des clients ont déjà rejoint la nouvelle partie.
        try {
          const sockets = await io.in(roomName(oldId)).fetchSockets()
          for (const s of sockets) {
            const sd = s.data as SocketData
            if (sd.role === 'player' && sd.playerId) {
              const oldPlayer = oldSession.players[sd.playerId]
              if (!oldPlayer) continue
              try {
                // Pas de contrôle de plafond : la partie d'origine le respectait déjà.
                const { player } = await engine.addPlayer(neu.id, oldPlayer.nickname)
                newMeta.seatsTaken += 1
                const dbPlayer = await withTenantTx(appDb, { tenantId: newMeta.tenantId }, (scope) =>
                  addSessionPlayer(scope.db, newMeta.dbSessionId, {
                    nickname: oldPlayer.nickname,
                    joinToken: player.joinToken,
                  }),
                )
                newMeta.playerDbIds.set(player.id, dbPlayer.id)
                s.emit('session:relaunched', {
                  role: 'player',
                  pin: neu.pin,
                  playerId: player.id,
                  joinToken: player.joinToken,
                  nickname: oldPlayer.nickname,
                })
              } catch (err) {
                /* best-effort : ce participant reste sur l'ancien podium */
                console.error(`host:relaunch : migration du joueur ${oldPlayer.nickname} (${sd.playerId}) échouée`, err)
              }
            } else if (sd.role === 'screen') {
              try {
                const displayToken = crypto.randomUUID()
                screenTokenToSessionId.set(displayToken, neu.id)
                s.emit('session:relaunched', { role: 'screen', pin: neu.pin, sessionId: neu.id, displayToken })
              } catch (err) {
                console.error('host:relaunch : migration du grand écran échouée', err)
              }
            }
            // role 'host' (socket appelante) : ignorée, l'ack suffit.
          }
        } catch (err) {
          console.error('host:relaunch : migration échouée (relance maintenue)', err)
        }

        reply({ sessionId: neu.id, pin: neu.pin })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Reconnexion hôte (Task 1, hardening ; Task 8, snapshot + reprise depuis Home ; Task 2,
    // unification moteur↔DB) : l'autorité hôte était liée à UN SEUL socket (posée par
    // host:create) — un simple rechargement de page perdait DÉFINITIVEMENT le contrôle de la
    // partie. Le client renvoie un `sessionId` — reçu à host:create (persisté côté client, ex.
    // localStorage, ou déjà présent dans l'URL `/host/:sessionId` après un simple F5) OU listé
    // par `Home.tsx` via `listSessions()` (reprise d'une partie live depuis l'accueil) : depuis
    // l'unification moteur↔DB, c'est EXACTEMENT le même id dans les deux cas — plus de résolution
    // via une table de correspondance inverse, `sessionMetaByEngineId.get(sessionId)` directement.
    // On ré-authentifie ensuite via la session Better Auth du NOUVEAU handshake et on vérifie
    // qu'il s'agit bien de l'hôte de CETTE session avant de rebind `socket.data` + rejoindre la
    // room. Double vérification (défense en profondeur) : l'état moteur EN MÉMOIRE
    // (`session.hostId`, source de vérité pendant la partie) ET la ligne `game_session.host_id`
    // PERSISTÉE — un écart entre les deux (qui ne devrait jamais arriver) fait échouer FERMÉ
    // plutôt que de faire confiance à une seule source. Pousse enfin un snapshot de l'état
    // courant à CE socket (`emitReconnectSnapshot`) : sans lui, l'hôte reprendrait la main sur une
    // partie dont l'écran ne montre rien (aucun joueur, aucune question) jusqu'au prochain
    // événement diffusé à toute la room.
    socket.on('host:reconnect', async (payload: { sessionId?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const sessionId = payload?.sessionId
        if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId requis')

        const meta = sessionMetaByEngineId.get(sessionId)
        if (!meta) throw new Error('session introuvable')

        const authSession = await auth.api.getSession({ headers: fromNodeHeaders(socket.handshake.headers) })
        if (!authSession?.user) throw new Error('authentification requise')

        const session = await engine.getSession(sessionId)
        if (session.hostId !== authSession.user.id) {
          throw new Error("cet utilisateur n'est pas l'hôte de cette session")
        }
        const dbSession = await withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) =>
          getGameSessionById(scope.db, meta.dbSessionId),
        )
        if (!dbSession || dbSession.hostId !== authSession.user.id) {
          throw new Error("cet utilisateur n'est pas l'hôte de cette session")
        }
        // Un hôte retiré de l'espace ne reprend pas la main sur ses parties en cours.
        await assertHostMembership(authSession.user.id, meta.tenantId)

        // Une socket qui devient hôte rend d'abord le siège joueur qu'elle occupait.
        await releasePlayerSeat(socket)
        const data = socket.data as SocketData
        data.role = 'host'
        data.sessionId = sessionId
        await socket.join(roomName(sessionId))
        await socket.join(viewersRoomName(sessionId))
        emitReconnectSnapshot(socket, session)
        // Enchaînement automatique : rejoue le compte à rebours en cours à l'hôte qui reprend en
        // pleine étape classement (le minuteur serveur, lui, continue de tourner sans être touché),
        // pour qu'il revoie le compteur plutôt qu'un écran figé.
        if (
          meta.autoAdvance &&
          meta.advanceNextAt !== null &&
          (session.phase === 'reveal' || session.phase === 'scoreboard')
        ) {
          socket.emit('auto:advance', { nextAt: meta.advanceNextAt })
        }

        // `sessionId` renvoyé ici est EXACTEMENT celui reçu en entrée (id unifié moteur↔DB,
        // Task 2) — c'est celui que la passerelle utilise partout ailleurs (room, tokens grand
        // écran…) ; le front s'en ressert pour le reste de la session (voir `HostLive.tsx`).
        // Phase d'AFFICHAGE : après une question non notée, la session est en 'scoreboard' côté
        // serveur mais l'hôte doit retrouver la révélation (et « Suivant »), pas le classement.
        const displayPhase =
          session.phase === 'scoreboard' && !engine.isCurrentQuestionScored(session) ? 'reveal' : session.phase
        reply({
          sessionId,
          pin: session.pin,
          phase: displayPhase,
          autoAdvance: meta.autoAdvance,
          autoAdvanceDelaySeconds: meta.autoAdvanceDelayMs / 1000,
        })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    socket.on('host:start', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = await requireLiveHost(socket)
        if (!meta.statusActiveSet) {
          await withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) =>
            setSessionStatus(scope.db, meta.dbSessionId, 'active'),
          )
          meta.statusActiveSet = true
        }
        // Démarrage de la question : voir `startQuestionFlow` (route 'reading' vs 'question'
        // selon le `readingTime` de la question — anti-triche : SEULE une projection sans la
        // bonne réponse est diffusée, à TOUTE la room, que ce soit `question:reading` ou
        // `question:show`).
        const session = await startQuestionFlow(sessionId, meta)
        const view = session.phase === 'reading' ? engine.readingView(session) : engine.playerQuestionView(session)
        reply(view)
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Garde `host:reveal` hors phase question (ex. juste après host:create, encore en lobby) :
    // sans ce garde, engine.reveal() ferait quand même avancer la phase et émettrait un
    // `question:reveal { correct: undefined }` / `scoreboard` bidon (aucune question courante).
    // Volontairement PAS dans `doReveal` (le garde équivalent pour `host:skip` vit dans `doSkip`) :
    // le garde vit uniquement dans ce handler `host:reveal`.
    socket.on('host:reveal', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId } = await requireLiveHost(socket)
        const current = await engine.getSession(sessionId)
        if (current.phase === 'lobby') {
          throw new Error('host:reveal : aucune question active (session encore en lobby)')
        }
      } catch (e) {
        reply({ error: message(e) })
        return
      }
      void doReveal(socket, ack)
    })
    // `host:skip` : un VRAI skip (voir `doSkip`) — plus un simple alias de `doReveal`. Ne
    // diffuse JAMAIS `question:reveal` : c'est la garantie anti-triche/anti-mensonge de cet
    // événement (l'ancien alias annonçait "passer" tout en révélant quand même la réponse à
    // toute la room).
    socket.on('host:skip', (_payload: unknown, ack?: (res: unknown) => void) => void doSkip(socket, ack))

    socket.on('host:next', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = await requireLiveHost(socket)
        // Geste manuel « Suivant » : même corps que l'avance automatique (`doAdvance`), qui gère
        // l'annulation de tous les minuteurs, la révélation de filet de sécurité d'une manche
        // encore en phase 'question' (host:next anticipé, sans reveal préalable), puis le routage
        // vers la question suivante ou le podium (statut DB + nettoyage + éviction différée).
        const session = await doAdvance(sessionId, meta)
        reply({ phase: session.phase })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Enchaînement automatique des étapes (demande produit) : l'hôte active/désactive le mode et
    // règle le délai de pause sur le classement. Réservé à l'hôte (`requireLiveHost`). Activer pendant
    // une étape classement en cours planifie l'avance immédiatement ; désactiver annule toute
    // avance planifiée et notifie les clients d'effacer leur compte à rebours (`auto:advance`
    // `{ nextAt: null }`).
    socket.on(
      'host:setAuto',
      async (payload: { enabled?: unknown; delaySeconds?: unknown } | undefined, ack?: (res: unknown) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {}
        try {
          const { sessionId, meta } = await requireLiveHost(socket)
          if (typeof payload?.enabled === 'boolean') meta.autoAdvance = payload.enabled
          if (typeof payload?.delaySeconds === 'number' && Number.isFinite(payload.delaySeconds)) {
            const clamped = Math.min(Math.max(payload.delaySeconds, MIN_AUTO_ADVANCE_DELAY_S), MAX_AUTO_ADVANCE_DELAY_S)
            meta.autoAdvanceDelayMs = clamped * 1000
          }
          const current = await engine.getSession(sessionId)
          if (!meta.autoAdvance) {
            clearAdvanceTimeout(meta)
            io.to(roomName(sessionId)).emit('auto:advance', { nextAt: null })
          } else if (current.phase === 'reveal' || current.phase === 'scoreboard') {
            // Activé en pleine étape classement : enchaîne sans attendre la manche suivante.
            scheduleAutoAdvance(sessionId, meta, current)
          }
          reply({ ok: true, autoAdvance: meta.autoAdvance, delaySeconds: meta.autoAdvanceDelayMs / 1000 })
        } catch (e) {
          reply({ error: message(e) })
        }
      },
    )

    // Modération du nuage : l'hôte retire un mot (toutes ses graphies fusionnées). Le retrait est
    // enregistré dans l'état moteur et dans `game_session.wordcloud_removed`, puis le nuage est
    // rediffusé aussitôt à l'hôte et au grand écran.
    socket.on('host:wordcloudRemove', async (payload: { word?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = await requireLiveHost(socket)
        const word = payload?.word
        if (typeof word !== 'string' || !word.trim()) throw new Error('mot requis')
        if (word.trim().length > WORDCLOUD_MAX_WORD_LENGTH) throw new Error('mot trop long')
        if (wordKey(word) === '') throw new Error('mot invalide')
        const { questionId, removedKeys } = await engine.removeWord(sessionId, word)
        await withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) =>
          setWordcloudRemoved(scope.db, meta.dbSessionId, questionId, removedKeys),
        )
        await flushWordcloudBroadcast(sessionId, meta)
        reply({ ok: true })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Exclusion d'un joueur par l'hôte (lobby comme en cours de partie, refusée au podium par le
    // moteur). Ordre IMPORTANT : 1) moteur (`kickPlayer` retire le joueur, sa réponse à une manche
    // non créditée, et mémorise son joinToken dans `kickedJoinTokens`, persisté avec l'état : un
    // `player:reconnect` sur ce jeton est refusé, même après redémarrage) ; 2) `meta.playerDbIds`
    // purgé AVANT toute I/O, pour qu'un `persistRound`/`persistPlayerScores` lancé ensuite ne vise
    // plus la ligne ; 3) suppression de la ligne `session_player` (RLS, tenant de la session), en
    // best-effort : un échec est journalisé et n'empêche jamais les notifications, diffusions et
    // l'auto-révélation qui suivent (sans quoi le kick resterait à moitié appliqué). Risque connu (non couvert) : un `persistRound` DÉJÀ en vol pour la manche courante a pu lire
    // l'id de ligne avant l'étape 2 ; son `recordAnswer` échoue alors sur la FK (ligne supprimée)
    // et annule la transaction de la manche, sans cicatrisation au boot. La fenêtre se réduit au
    // trajet aller-retour d'une transaction déjà commencée. Idempotent : un joueur déjà absent
    // (double clic, double onglet hôte) répond `ok` sans aucune diffusion. Aucune annonce publique :
    // seul le(s) socket(s) du joueur exclu reçoit `player:kicked`, les autres ne voient que la
    // liste mise à jour.
    socket.on('host:kick', async (payload: { playerId?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = await requireLiveHost(socket)
        const playerId = payload?.playerId
        if (typeof playerId !== 'string' || !playerId) throw new Error('playerId requis')

        const { session, kicked } = await engine.kickPlayer(sessionId, playerId)
        if (kicked === null) {
          reply({ ok: true })
          return
        }

        // Le joueur quitte la session : sa place se libère pour le plafond MAX_PLAYERS_PER_SESSION.
        meta.seatsTaken -= 1
        const dbPlayerId = meta.playerDbIds.get(playerId)
        meta.playerDbIds.delete(playerId)
        if (dbPlayerId) {
          // Best-effort : l'exclusion est déjà actée côté moteur (et persistée). Un échec base ici
          // ne doit PAS interrompre la suite, sinon le kick resterait à moitié appliqué sans
          // rattrapage possible (un nouveau `host:kick` répond `kicked: null`, donc rien n'est
          // diffusé) : socket de l'exclu toujours dans la room, listes périmées, manche bloquée.
          // La ligne orpheline n'est plus visée par aucune écriture (`playerDbIds` déjà purgé).
          try {
            await withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) => deleteSessionPlayer(scope.db, dbPlayerId))
          } catch (err) {
            console.error(
              `host:kick : suppression de la ligne session_player ${dbPlayerId} échouée (exclusion maintenue)`,
              err,
            )
          }
        }

        // Tous les sockets locaux encore rattachés à ce joueur (y compris un ancien socket resté
        // ouvert après une reconnexion ailleurs) : prévenus, sortis de la room et détachés (plus
        // de `player:answer` possible). Les champs de throttle sont conservés.
        const room = roomName(sessionId)
        for (const s of io.of('/').sockets.values()) {
          const data = s.data as SocketData
          if (data.sessionId !== sessionId || data.playerId !== playerId) continue
          s.emit('player:kicked', {})
          s.leave(room)
          data.role = undefined
          data.sessionId = undefined
          data.playerId = undefined
        }
        activeSocketIdByPlayerId.delete(playerId)

        scheduleLobbyBroadcast(sessionId)

        // En pleine question : le total du compteur baisse, et exclure le dernier joueur sans
        // réponse complète la manche (auto-révélation best-effort, comme après `player:answer`).
        if (session.phase === 'question') {
          io.to(viewersRoomName(sessionId)).emit('screen:progress', await engine.progress(sessionId))
          await maybeAutoReveal(sessionId, meta).catch(() => {})
        }
        reply({ ok: true })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    socket.on(
      'player:join',
      async (payload: { pin?: unknown; nickname?: unknown } | undefined, ack?: (res: unknown) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {}
        try {
          const pin = payload?.pin
          if (typeof pin !== 'string' || !pin) throw new Error('pin requis')
          // Pseudo borné à 32 caractères (P2) et trimmé : sans borne, un joueur pouvait diffuser
          // un pseudo géant rediffusé à l'hôte et à l'écran (lobby:update) et persisté en base.
          const nickname = typeof payload?.nickname === 'string' ? payload.nickname.trim() : ''
          if (!nickname) throw new Error('nickname requis')
          if (nickname.length > 32) throw new Error('nickname trop long (32 caractères max)')
          assertNotHostOrScreen(socket)
          assertPinBudget(socket)

          const sessionId = pinToSessionId.get(pin)
          if (!sessionId) {
            recordPinFailure(socket)
            throw new Error('PIN invalide')
          }
          const meta = sessionMetaByEngineId.get(sessionId)
          if (!meta) {
            recordPinFailure(socket)
            throw new Error('session introuvable')
          }
          // Le siège courant n'est libéré qu'une fois le PIN résolu : un PIN faux ou bloqué laisse
          // le joueur à sa place.
          await releasePlayerSeat(socket)

          // Plafond : place réservée de façon synchrone (aucun `await` entre lecture et incrément),
          // rendue si le joueur n'a pas pu être ajouté au moteur. Une fois ajouté, il l'occupe même
          // si la suite échoue (il existe côté moteur et pourrait revenir).
          if (meta.seatsTaken >= config.maxPlayersPerSession) throw new Error(SESSION_FULL_MESSAGE)
          meta.seatsTaken += 1
          let added = false
          try {
            const { session, player } = await engine.addPlayer(sessionId, nickname)
            added = true
            const dbPlayer = await withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) =>
              addSessionPlayer(scope.db, meta.dbSessionId, { nickname, joinToken: player.joinToken }),
            )
            meta.playerDbIds.set(player.id, dbPlayer.id)

            // Un player:join concurrent sur la même socket a pu prendre un siège pendant les `await` :
            // on le libère avant d'attribuer celui-ci (détachement synchrone, voir releasePlayerSeat).
            void releasePlayerSeat(socket)
            const data = socket.data as SocketData
            data.role = 'player'
            data.sessionId = sessionId
            data.playerId = player.id
            activeSocketIdByPlayerId.set(player.id, socket.id)
            await socket.join(roomName(sessionId))

            reply({ playerId: player.id, joinToken: player.joinToken })
            // Liste complète à l'hôte et à l'écran, nombre seul aux joueurs, diffusion coalescée :
            // une rafale d'arrivées ne rediffuse plus toute la liste à chaque joueur.
            scheduleLobbyBroadcast(sessionId)

            // Latecomer (Task 3, hardening) : un joueur qui rejoint EN PLEINE QUESTION (ex. PIN
            // partagé après le lancement) ne doit pas rester aveugle jusqu'à la question suivante —
            // on lui rejoue, à LUI SEUL, la même projection anti-triche que host:start/host:next.
            replayCurrentQuestionTo(socket, session)
          } catch (e) {
            if (!added) meta.seatsTaken -= 1
            throw e
          }
        } catch (e) {
          reply({ error: message(e) })
        }
      },
    )

    socket.on('player:answer', async (payload: { answer?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const data = socket.data as SocketData
        if (data.role !== 'player' || !data.sessionId || !data.playerId) {
          throw new Error('joueur non rattaché à une session')
        }
        // Horodatage 100% serveur : engine.submitAnswer utilise `now()` en interne, jamais un
        // timing fourni par le client.
        const result = await engine.submitAnswer(data.sessionId, data.playerId, payload?.answer)
        if (result.accepted) {
          // Nuage : un joueur ne compte qu'une fois dans le compteur, à son premier mot.
          const words = result.words
          if (!words || words.length === 1) {
            // Compteur grand écran : UNIQUEMENT answered/total, jamais le contenu de la réponse
            // ni la bonne réponse (anti-triche, voir engine.progress()).
            const progress = await engine.progress(data.sessionId)
            io.to(viewersRoomName(data.sessionId)).emit('screen:progress', progress)
          }
          if (words) {
            const meta = sessionMetaByEngineId.get(data.sessionId)
            if (meta) scheduleWordcloudBroadcast(data.sessionId, meta)
          }
        }
        reply(result)

        // Auto-révélation serveur (voir `maybeAutoReveal`) : dès que TOUS les joueurs connectés ont
        // répondu, on révèle sans attendre l'hôte ni le timer (le chrono s'arrête côté clients au
        // passage en 'reveal'). Best-effort et isolé : une erreur ici ne doit jamais affecter la
        // réponse déjà acquittée au joueur.
        if (result.accepted) {
          try {
            const meta = sessionMetaByEngineId.get(data.sessionId)
            if (meta) await maybeAutoReveal(data.sessionId, meta)
          } catch {
            // best-effort — l'hôte peut toujours révéler manuellement
          }
        }
      } catch (e) {
        reply({ accepted: false, error: message(e) })
      }
    })

    // Reconnexion (join_token) : le client envoie { pin, joinToken } — le PIN (visible/mémorisable
    // par le joueur) plutôt qu'un sessionId interne, symétrique de player:join. Le moteur retrouve
    // le joueur par joinToken, le remarque connected, et son score/état sont conservés (le moteur
    // ne réinitialise jamais un joueur existant — voir engine.reconnect()).
    socket.on(
      'player:reconnect',
      async (payload: { pin?: unknown; joinToken?: unknown } | undefined, ack?: (res: unknown) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {}
        try {
          const pin = payload?.pin
          const joinToken = payload?.joinToken
          if (typeof pin !== 'string' || !pin) throw new Error('pin requis')
          if (typeof joinToken !== 'string' || !joinToken) throw new Error('joinToken requis')
          assertNotHostOrScreen(socket)
          // Pas de budget d'échecs de PIN ici, volontairement. La réponse uniforme ci-dessous retire
          // déjà l'oracle d'existence du PIN, et le joinToken est un secret impossible à deviner :
          // le budget n'apporterait rien. Il nuirait en revanche aux joueurs légitimes : PlayerLive
          // traite toute erreur de reconnexion comme un jeton invalide et efface le jeton (le joueur
          // perd sa place et son score), et les onglets périmés d'une classe derrière un NAT (partie
          // évincée après le podium) épuiseraient le budget commun, bloquant le player:join suivant.
          const sessionId = pinToSessionId.get(pin)
          if (!sessionId || !sessionMetaByEngineId.has(sessionId)) throw new Error(RECONNECT_INVALID_MESSAGE)

          const result = await engine.reconnect(sessionId, joinToken)
          if (!result) throw new Error(RECONNECT_INVALID_MESSAGE)
          const { session, player } = result

          // Le siège courant n'est libéré qu'après une reconnexion réussie : le libérer dès le PIN
          // résolu (jeton encore inconnu) faisait d'un mauvais jeton un oracle d'existence du PIN,
          // la socket ne perdant sa place que si le PIN existait. Rien à libérer quand la socket
          // porte déjà ce joueur (reconnexion répétée ou concurrente) : la libération le
          // repasserait hors ligne alors que `engine.reconnect` vient de le remettre en ligne.
          if ((socket.data as SocketData).playerId !== player.id) void releasePlayerSeat(socket)
          const data = socket.data as SocketData
          data.role = 'player'
          data.sessionId = sessionId
          data.playerId = player.id
          // CE socket devient le socket actif du joueur — voir le garde dans le handler
          // `disconnect` : un disconnect tardif de l'ANCIEN socket ne devra plus rien changer.
          activeSocketIdByPlayerId.set(player.id, socket.id)
          await socket.join(roomName(sessionId))

          // "Déjà répondu" (hardening, Task 5) : `question:show` (replayé ci-dessous) rend un
          // client qui avait DÉJÀ soumis pour la question en cours indiscernable d'un client qui
          // n'a pas encore répondu — sans ce booléen, l'UI reconnectée affiche à tort "en attente
          // de réponse" à côté d'un score pourtant déjà crédité pour cette manche. Ne lit QUE
          // l'existence d'une réponse (booléen) — jamais son contenu (`submitted.answer`/`.correct`
          // ne sont jamais exposés ici, anti-triche).
          const alreadyAnswered = Boolean(session.answers[session.currentIndex]?.[player.id])

          reply({ playerId: player.id, phase: session.phase, score: player.score, alreadyAnswered })
          // Même diffusion coalescée que player:join : le joueur reçoit un `lobby:count` à jour,
          // l'hôte et l'écran le voient `connected: true` dans le `lobby:update` suivant.
          scheduleLobbyBroadcast(sessionId)

          // Un joueur qui reconnecte EN PLEINE QUESTION doit pouvoir la voir/y répondre tout de
          // suite, pas seulement à partir de la question suivante : on lui renvoie, à LUI SEUL
          // (pas à la room — les autres l'ont déjà reçu), la même projection anti-triche que
          // host:start/host:next (`playerQuestionView`, jamais `questionResult`) + le `timer`.
          replayCurrentQuestionTo(socket, session, alreadyAnswered)
        } catch (e) {
          // Jeton exclu par l'hôte (`host:kick`) : code dédié pour que le client affiche l'écran
          // « retiré de la partie » et oublie le jeton, au lieu de retenter une reconnexion.
          reply(e instanceof PlayerKickedError ? { error: e.message, code: e.code } : { error: message(e) })
        }
      },
    )

    // Marque le joueur non-connecté sans le retirer de la session (score/réponses conservés,
    // récupérables via player:reconnect). Ne s'applique qu'aux sockets 'player' rattachés, et
    // SEULEMENT si CE socket est toujours le socket actif référencé pour ce joueur — sinon un
    // disconnect tardif de l'ANCIEN socket (Socket.IO peut détecter la coupure d'un client mort
    // jusqu'à ~pingTimeout après coup) écraserait à tort `connected:true` posé par une
    // reconnexion entre-temps déjà survenue sur un nouveau socket.
    socket.on('disconnect', () => {
      const data = socket.data as SocketData
      if (data.role === 'player' && data.sessionId && data.playerId) {
        if (activeSocketIdByPlayerId.get(data.playerId) === socket.id) {
          engine.setPlayerConnected(data.sessionId, data.playerId, false).catch(() => {})
        }
      }
    })

    // Grand écran : token d'affichage à usage unique, obtenu par l'hôte via host:createScreenToken.
    socket.on('host:createScreenToken', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId } = await requireLiveHost(socket)
        const displayToken = crypto.randomUUID()
        screenTokenToSessionId.set(displayToken, sessionId)
        reply({ displayToken })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    socket.on('screen:join', async (payload: { displayToken?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const displayToken = payload?.displayToken
        if (typeof displayToken !== 'string' || !displayToken) throw new Error('displayToken requis')

        const sessionId = screenTokenToSessionId.get(displayToken)
        if (!sessionId) throw new Error('displayToken invalide ou déjà utilisé')
        // Prise de contrôle initiale à usage unique : refusée si CE token a déjà servi une
        // première fois — mais on ne SUPPRIME plus la correspondance token → session (voir
        // `screenTokenToSessionId` plus haut) : elle reste valable pour `screen:reconnect`.
        if (consumedScreenTokens.has(displayToken)) throw new Error('displayToken invalide ou déjà utilisé')
        consumedScreenTokens.add(displayToken)
        if (!sessionMetaByEngineId.has(sessionId)) throw new Error('session introuvable')

        // Une socket qui devient écran rend d'abord le siège joueur qu'elle occupait (sinon il
        // resterait `connected: true` sans socket pour le porter).
        await releasePlayerSeat(socket)
        const data = socket.data as SocketData
        data.role = 'screen'
        data.sessionId = sessionId
        await socket.join(roomName(sessionId))
        await socket.join(viewersRoomName(sessionId))
        reply({ ok: true })

        // Latecomer (Task 3, hardening) : le grand écran connecté en PLEINE QUESTION doit
        // afficher la question courante tout de suite, pas seulement à partir de la suivante.
        const session = await engine.getSession(sessionId)
        replayCurrentQuestionTo(socket, session)
        // Clôture d'une question non notée : l'écran reste sur la révélation, rejouée ici (nuage
        // compris) ; sinon, rejeu du nuage en cours comme avant.
        if (!replayUnscoredRevealTo(socket, session)) replayWordcloudTo(socket, session)
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Reconnexion grand écran (Task 2, hardening) : un blip réseau ne doit plus tuer le
    // projecteur définitivement. Réutilise le MÊME `displayToken` (déjà connu du client, ex.
    // localStorage) — il reste "unguessable" (UUID v4, jamais raccourci/dérivé) — mais cette
    // fois SANS exiger qu'il soit encore "non consommé" : `screen:reconnect` fonctionne aussi
    // bien pour la toute première prise de contrôle que pour un ré-accrochage ultérieur, tant
    // que le token correspond bien à LA session demandée (`sessionId`, connu du client) et que
    // la session existe toujours.
    socket.on(
      'screen:reconnect',
      async (payload: { sessionId?: unknown; displayToken?: unknown } | undefined, ack?: (res: unknown) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {}
        try {
          const sessionId = payload?.sessionId
          const displayToken = payload?.displayToken
          if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId requis')
          if (typeof displayToken !== 'string' || !displayToken) throw new Error('displayToken requis')

          const mappedSessionId = screenTokenToSessionId.get(displayToken)
          if (!mappedSessionId || mappedSessionId !== sessionId) throw new Error('displayToken invalide')
          if (!sessionMetaByEngineId.has(sessionId)) throw new Error('session introuvable')

          // Une socket qui devient écran rend d'abord le siège joueur qu'elle occupait (sinon il
          // resterait `connected: true` sans socket pour le porter).
          await releasePlayerSeat(socket)
          const data = socket.data as SocketData
          data.role = 'screen'
          data.sessionId = sessionId
          await socket.join(roomName(sessionId))
          await socket.join(viewersRoomName(sessionId))
          reply({ ok: true })

          const session = await engine.getSession(sessionId)
          replayCurrentQuestionTo(socket, session)
          if (!replayUnscoredRevealTo(socket, session)) replayWordcloudTo(socket, session)
        } catch (e) {
          reply({ error: message(e) })
        }
      },
    )
  })

  /** Balayage d'abandon (mono-instance) : bascule en base les parties inactives (autoritatif via
   * `abandonInactiveSessions`), puis nettoie l'état mémoire LOCAL de CE process pour chacune —
   * annule le minuteur de fin de lecture (sinon révélation fantôme) et la diffusion différée du
   * lobby, retire les entrées de
   * correspondance, et évince le cache du store (le PIN redevient réutilisable). Best-effort :
   * une session déjà absente de la mémoire (ex. jamais pilotée par ce process) est simplement
   * ignorée par les `get`/`delete` de Map. Appelé périodiquement par la composition root. */
  async function sweepAbandonedSessions(): Promise<void> {
    const ids = await abandonInactiveSessions(systemDb, config.sessionInactivityTimeoutMs)
    for (const id of ids) {
      const meta = sessionMetaByEngineId.get(id)
      if (meta) {
        clearReadingTimeout(meta)
        clearLobbyBroadcastTimeout(meta)
        clearWordcloudBroadcastTimeout(meta)
      }
      sessionMetaByEngineId.delete(id)
      const pin = store.evict(id)
      if (pin) pinToSessionId.delete(pin)
      for (const [token, sid] of screenTokenToSessionId) {
        if (sid === id) screenTokenToSessionId.delete(token)
      }
    }
  }

  // Réhydratation au montage (Task 4) : APRÈS avoir câblé tous les handlers (une reconnexion
  // qui arriverait entre-temps, ex. juste après `io.on('connection', …)`, trouve déjà tout en
  // place) mais avant que `registerGameGateway` ne rende la main — `index.ts`/les tests
  // (`buildApp`) l'attendent donc explicitement (`await registerGameGateway(...)`), garantissant
  // qu'aucune reconnexion n'est traitée avant que la reprise ne soit terminée.
  await rehydrateActiveSessions(SESSION_MAX_AGE)

  return { sweepAbandonedSessions }
}
