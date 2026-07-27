import type { Server, Socket } from 'socket.io'
import { fromNodeHeaders } from 'better-auth/node'
import {
  resolveTenantId, tenantScope, listQuestions,
  createGameSession, getGameSessionById, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
  type Db,
} from '@splootlabs/db'
import type { Auth } from '@splootlabs/auth'
import type { AppConfig } from '@splootlabs/shared'
import type { Engine, EngineQuestion, GameSession } from '@splootlabs/game'

export type GameGatewayDeps = {
  engine: Engine
  db: Db
  auth: Auth
  config: AppConfig
}

/** Métadonnées côté passerelle reliant une session moteur (mémoire) à sa persistance en base. */
type SessionMeta = {
  dbSessionId: string
  tenantId: string
  /** playerId moteur (genId()) → id de ligne `session_player` en base (ids indépendants). */
  playerDbIds: Map<string, string>
  /** Index de question déjà persistés (recordAnswer) — évite un double-insert si host:reveal
   * (ou host:skip, qui crédite/persiste aussi — voir `doSkip`) est invoqué plusieurs fois sur
   * la même manche. */
  revealedRounds: Set<number>
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
}

type SocketData = {
  role?: 'host' | 'player' | 'screen'
  sessionId?: string
  playerId?: string
}

function roomName(sessionId: string): string {
  return `session:${sessionId}`
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'erreur inconnue'
}

/** Un seul type de question en base pour l'instant : pas de champ `basePoints` dédié au schéma
 * (voir plan, notes de fin) — 1000 par défaut, aligné sur le prototype Kahoot. */
const DEFAULT_BASE_POINTS = 1000

function toEngineQuestion(row: { id: string; type: string; prompt: string; timeLimit: number; readingTime: number; payload: unknown }): EngineQuestion {
  return {
    id: row.id,
    type: row.type as EngineQuestion['type'],
    prompt: row.prompt,
    timeLimit: row.timeLimit,
    readingTime: row.readingTime,
    basePoints: DEFAULT_BASE_POINTS,
    payload: row.payload,
  }
}

function playersPayload(session: GameSession): Array<{ id: string; nickname: string; score: number; connected: boolean }> {
  return Object.values(session.players).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    connected: p.connected,
  }))
}

export function registerGameGateway(io: Server, deps: GameGatewayDeps): void {
  const { engine, db, auth, config } = deps

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

  function requireHost(socket: Socket): { sessionId: string; meta: SessionMeta } {
    const data = socket.data as SocketData
    if (data.role !== 'host' || !data.sessionId) throw new Error('action réservée à l\'hôte de la session')
    const meta = sessionMetaByEngineId.get(data.sessionId)
    if (!meta) throw new Error('session introuvable')
    return { sessionId: data.sessionId, meta }
  }

  /** Persiste les réponses + scores de la manche EN COURS (session.currentIndex), après reveal().
   * Idempotent via `meta.revealedRounds` : un reveal rejoué (host:reveal ou host:skip) sur la
   * même manche ne réinsère jamais les mêmes answer_record. */
  async function persistRound(meta: SessionMeta, session: GameSession): Promise<void> {
    const idx = session.currentIndex
    const question = session.questions[idx]
    if (!question || meta.revealedRounds.has(idx)) return
    meta.revealedRounds.add(idx)

    const roundAnswers = session.answers[idx] ?? {}
    for (const [enginePlayerId, submitted] of Object.entries(roundAnswers)) {
      const dbPlayerId = meta.playerDbIds.get(enginePlayerId)
      if (!dbPlayerId) continue
      await recordAnswer(db, {
        sessionId: meta.dbSessionId,
        questionId: question.id,
        playerId: dbPlayerId,
        answer: submitted.answer,
        timeMs: submitted.timeMs,
        isCorrect: submitted.correct,
        points: submitted.points,
      })
    }
    for (const player of Object.values(session.players)) {
      const dbPlayerId = meta.playerDbIds.get(player.id)
      if (!dbPlayerId) continue
      await setPlayerScore(db, dbPlayerId, player.score)
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
  async function doRevealBySession(sessionId: string, meta: SessionMeta): Promise<void> {
    // Annulation : une révélation manuelle (ou auto-révélation) qui arrive PENDANT la phase
    // 'reading' (ex. host:reveal anticipé — voir le garde dans le handler `host:reveal`, qui
    // laisse passer 'reading' comme n'importe quelle phase hors 'lobby') doit annuler le minuteur
    // planifié par `startQuestionFlow` — sinon celui-ci se déclencherait une seconde fois plus
    // tard (révélation fantôme) sur une manche déjà avancée par ce chemin-ci.
    clearReadingTimeout(meta)
    const revealed = await engine.reveal(sessionId)

    // Anti-triche : `questionResult` (qui contient la bonne réponse) n'est calculé qu'ICI,
    // strictement après engine.reveal() — jamais avant, jamais pour `question:show`.
    const result = engine.questionResult(revealed)
    io.to(roomName(sessionId)).emit('question:reveal', result)

    const scored = await engine.scoreboard(sessionId)
    const ranking = engine.ranking(scored)
    io.to(roomName(sessionId)).emit('scoreboard', { ranking })

    await persistRound(meta, revealed)
  }

  /** `host:reveal` : révèle la bonne réponse (`question:reveal`) puis le classement cumulé
   * (`scoreboard`). Crédite les points de la manche EXACTEMENT une fois (idempotent via
   * `engine.reveal`/`persistRound`, voir leurs commentaires). */
  async function doReveal(socket: Socket, ack?: (res: unknown) => void): Promise<void> {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const { sessionId, meta } = requireHost(socket)
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
   * `questionResult`/`question:reveal` n'est jamais calculé ni émis dans ce chemin. Émet quand
   * même `scoreboard` (classement cumulé, sans contenu de réponse — pas une fuite anti-triche)
   * pour que l'hôte/l'écran voient la partie avancer. */
  async function doSkip(socket: Socket, ack?: (res: unknown) => void): Promise<void> {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const { sessionId, meta } = requireHost(socket)
      const current = await engine.getSession(sessionId)
      if (current.phase === 'lobby') {
        throw new Error('host:skip : aucune question active (session encore en lobby)')
      }
      // Annulation : voir le commentaire équivalent dans `doRevealBySession` — un host:skip
      // anticipé pendant 'reading' ne doit jamais laisser un minuteur planifié se déclencher
      // après coup.
      clearReadingTimeout(meta)

      const revealed = await engine.reveal(sessionId) // crédite uniquement — PAS de question:reveal
      await persistRound(meta, revealed)

      const scored = await engine.scoreboard(sessionId)
      const ranking = engine.ranking(scored)
      io.to(roomName(sessionId)).emit('scoreboard', { ranking })

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
  }

  /** Rejoue la question en cours à UN SEUL socket qui vient de rejoindre/rafraîchir EN PLEINE
   * QUESTION (`player:join`/`screen:join` arrivant mid-question, symétrique du traitement déjà
   * fait par `player:reconnect`) — sans ça, un tel arrivant reste aveugle jusqu'à la question
   * suivante. Anti-triche : utilise EXCLUSIVEMENT `engine.playerQuestionView` (jamais le payload
   * brut ni `questionResult`), exactement comme `host:start`/`host:next`. Émis à CE socket
   * seulement (pas à la room — les autres l'ont déjà reçu). */
  function replayCurrentQuestionTo(socket: Socket, session: GameSession): void {
    if (session.phase !== 'question') return
    const view = engine.playerQuestionView(session)
    socket.emit('question:show', view)
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
        break
      case 'reveal': {
        const view = engine.playerQuestionView(session)
        if (view) socket.emit('question:show', view)
        socket.emit('question:reveal', engine.questionResult(session))
        socket.emit('scoreboard', { ranking: engine.ranking(session) })
        break
      }
      case 'scoreboard':
        socket.emit('scoreboard', { ranking: engine.ranking(session) })
        break
      case 'podium':
        socket.emit('scoreboard', { ranking: engine.ranking(session) })
        socket.emit('podium', { top: engine.ranking(session).slice(0, 3) })
        break
      case 'lobby':
      default:
        // Rien de plus : le `lobby:update` ci-dessus suffit déjà pour la phase 'lobby'.
        break
    }
  }

  io.on('connection', (socket: Socket) => {
    socket.on('host:create', async (payload: { quizId?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const authSession = await auth.api.getSession({ headers: fromNodeHeaders(socket.handshake.headers) })
        if (!authSession?.user) throw new Error('authentification requise')

        const quizId = payload?.quizId
        if (typeof quizId !== 'string' || !quizId) throw new Error('quizId requis')

        const tenantId = await resolveTenantId(db, config, { userId: authSession.user.id })
        const scope = tenantScope(db, tenantId)

        const questionRows = await listQuestions(scope, quizId)
        if (!questionRows) throw new Error('quiz introuvable')

        const questions = questionRows.map(toEngineQuestion)

        // DB d'abord (Task 2, unification moteur↔DB) : la ligne `game_session` doit exister
        // AVANT le premier `engine.createSession` (qui appelle `store.save` — Task 3/4, le store
        // persistant fait `UPDATE game_session SET engine_state=… WHERE id = session.id`, un
        // UPDATE sur une ligne inexistante ne persisterait rien). Il faut donc connaître le PIN
        // (généré par le moteur) AVANT de créer la ligne DB — d'où `generateUniquePin()`.
        const pin = await engine.generateUniquePin()
        const dbSession = await createGameSession(scope, { quizId, hostId: authSession.user.id, pin })
        if (!dbSession) throw new Error('création de la session impossible')

        // L'id `game_session` DB devient l'id moteur — UN SEUL id partout (plus de map de
        // correspondance inverse entre les deux, désormais inutile).
        const session = await engine.createSession({
          id: dbSession.id,
          pin,
          quizId,
          tenantId,
          hostId: authSession.user.id,
          questions,
        })

        sessionMetaByEngineId.set(session.id, {
          dbSessionId: dbSession.id,
          tenantId,
          playerDbIds: new Map(),
          revealedRounds: new Set(),
          autoRevealedRounds: new Set(),
          statusActiveSet: false,
          readingTimeout: null,
        })
        pinToSessionId.set(session.pin, session.id)

        const data = socket.data as SocketData
        data.role = 'host'
        data.sessionId = session.id
        await socket.join(roomName(session.id))

        reply({ sessionId: session.id, pin: session.pin })
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
        const dbSession = await getGameSessionById(db, meta.dbSessionId)
        if (!dbSession || dbSession.hostId !== authSession.user.id) {
          throw new Error("cet utilisateur n'est pas l'hôte de cette session")
        }

        const data = socket.data as SocketData
        data.role = 'host'
        data.sessionId = sessionId
        await socket.join(roomName(sessionId))
        emitReconnectSnapshot(socket, session)

        // `sessionId` renvoyé ici est EXACTEMENT celui reçu en entrée (id unifié moteur↔DB,
        // Task 2) — c'est celui que la passerelle utilise partout ailleurs (room, tokens grand
        // écran…) ; le front s'en ressert pour le reste de la session (voir `HostLive.tsx`).
        reply({ sessionId, pin: session.pin, phase: session.phase })
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    socket.on('host:start', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = requireHost(socket)
        if (!meta.statusActiveSet) {
          await setSessionStatus(db, meta.dbSessionId, 'active')
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
        const { sessionId } = requireHost(socket)
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
        const { sessionId, meta } = requireHost(socket)
        // Annulation : un host:next anticipé (ex. hôte qui écourte la phase 'reading' avant
        // échéance) doit annuler tout minuteur de fin de lecture encore planifié pour la manche
        // qu'on quitte — sans ça il se déclencherait plus tard sur une manche déjà avancée
        // (`revealAnswersFlow`/`engine.revealAnswers` restent de toute façon des no-op sûrs hors
        // phase 'reading', mais on ne laisse jamais un minuteur obsolète traîner).
        clearReadingTimeout(meta)
        // Bug important (revue finale) : engine.nextQuestion() ne révèle jamais la manche en
        // cours — si l'hôte enchaîne host:next SANS host:reveal préalable (phase encore
        // 'question'), les points de cette manche ne seraient jamais crédités ni persistés
        // (answer_record) alors que la partie avance quand même vers la manche suivante /
        // le podium. On révèle donc explicitement ici AVANT d'avancer, en réutilisant EXACTEMENT
        // le chemin de host:reveal (credit + persist + emit question:reveal/scoreboard).
        // Idempotent par construction : revealedRounds/credited (voir persistRound/engine.reveal)
        // empêchent tout double-crédit si la manche a déjà été révélée entre-temps.
        const current = await engine.getSession(sessionId)
        if (current.phase === 'question') {
          await doReveal(socket)
        }
        // Fin de partie (inchangée) vs démarrage de la question suivante — seul ce dernier
        // chemin passe désormais par `startQuestionFlow` (routage 'reading'/'question' identique
        // à host:start).
        if (current.currentIndex + 1 < current.questions.length) {
          const session = await startQuestionFlow(sessionId, meta)
          reply({ phase: session.phase })
        } else {
          const session = await engine.podium(sessionId)
          await setSessionStatus(db, meta.dbSessionId, 'ended')
          const top = engine.ranking(session).slice(0, 3)
          io.to(roomName(sessionId)).emit('podium', { top })
          reply({ phase: session.phase })
        }
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    socket.on('player:join', async (payload: { pin?: unknown; nickname?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const pin = payload?.pin
        const nickname = payload?.nickname
        if (typeof pin !== 'string' || !pin) throw new Error('pin requis')
        if (typeof nickname !== 'string' || !nickname.trim()) throw new Error('nickname requis')

        const sessionId = pinToSessionId.get(pin)
        if (!sessionId) throw new Error('PIN invalide')
        const meta = sessionMetaByEngineId.get(sessionId)
        if (!meta) throw new Error('session introuvable')

        const { session, player } = await engine.addPlayer(sessionId, nickname)
        const dbPlayer = await addSessionPlayer(db, meta.dbSessionId, { nickname, joinToken: player.joinToken })
        meta.playerDbIds.set(player.id, dbPlayer.id)

        const data = socket.data as SocketData
        data.role = 'player'
        data.sessionId = sessionId
        data.playerId = player.id
        activeSocketIdByPlayerId.set(player.id, socket.id)
        await socket.join(roomName(sessionId))

        reply({ playerId: player.id, joinToken: player.joinToken })
        io.to(roomName(sessionId)).emit('lobby:update', { players: playersPayload(session) })

        // Latecomer (Task 3, hardening) : un joueur qui rejoint EN PLEINE QUESTION (ex. PIN
        // partagé après le lancement) ne doit pas rester aveugle jusqu'à la question suivante —
        // on lui rejoue, à LUI SEUL, la même projection anti-triche que host:start/host:next.
        replayCurrentQuestionTo(socket, session)
      } catch (e) {
        reply({ error: message(e) })
      }
    })

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
          // Compteur grand écran : UNIQUEMENT answered/total, jamais le contenu de la réponse
          // ni la bonne réponse (anti-triche — voir engine.progress()).
          const progress = await engine.progress(data.sessionId)
          io.to(roomName(data.sessionId)).emit('screen:progress', progress)
        }
        reply(result)

        // Auto-révélation serveur : dès que TOUS les joueurs connectés ont répondu, on révèle
        // sans attendre l'hôte ni le timer (le chrono s'arrête côté clients au passage en 'reveal').
        // Best-effort et isolé : une erreur ici ne doit jamais affecter la réponse déjà acquittée au
        // joueur. Idempotent via meta.autoRevealedRounds (évite un double question:reveal/scoreboard si
        // deux dernières réponses arrivent quasi simultanément).
        if (result.accepted) {
          try {
            const meta = sessionMetaByEngineId.get(data.sessionId)
            const session = await engine.getSession(data.sessionId)
            if (meta && engine.allConnectedAnswered(session) && !meta.autoRevealedRounds.has(session.currentIndex)) {
              meta.autoRevealedRounds.add(session.currentIndex)
              await doRevealBySession(data.sessionId, meta)
            }
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
    socket.on('player:reconnect', async (payload: { pin?: unknown; joinToken?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const pin = payload?.pin
        const joinToken = payload?.joinToken
        if (typeof pin !== 'string' || !pin) throw new Error('pin requis')
        if (typeof joinToken !== 'string' || !joinToken) throw new Error('joinToken requis')

        const sessionId = pinToSessionId.get(pin)
        if (!sessionId) throw new Error('PIN invalide')
        if (!sessionMetaByEngineId.has(sessionId)) throw new Error('session introuvable')

        const result = await engine.reconnect(sessionId, joinToken)
        if (!result) throw new Error('joinToken invalide')
        const { session, player } = result

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
        io.to(roomName(sessionId)).emit('lobby:update', { players: playersPayload(session) })

        // Un joueur qui reconnecte EN PLEINE QUESTION doit pouvoir la voir/y répondre tout de
        // suite, pas seulement à partir de la question suivante : on lui renvoie, à LUI SEUL
        // (pas à la room — les autres l'ont déjà reçu), la même projection anti-triche que
        // host:start/host:next (`playerQuestionView`, jamais `questionResult`) + le `timer`.
        replayCurrentQuestionTo(socket, session)
      } catch (e) {
        reply({ error: message(e) })
      }
    })

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
    socket.on('host:createScreenToken', (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId } = requireHost(socket)
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

        const data = socket.data as SocketData
        data.role = 'screen'
        data.sessionId = sessionId
        await socket.join(roomName(sessionId))
        reply({ ok: true })

        // Latecomer (Task 3, hardening) : le grand écran connecté en PLEINE QUESTION doit
        // afficher la question courante tout de suite, pas seulement à partir de la suivante.
        const session = await engine.getSession(sessionId)
        replayCurrentQuestionTo(socket, session)
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
    socket.on('screen:reconnect', async (payload: { sessionId?: unknown; displayToken?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const sessionId = payload?.sessionId
        const displayToken = payload?.displayToken
        if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId requis')
        if (typeof displayToken !== 'string' || !displayToken) throw new Error('displayToken requis')

        const mappedSessionId = screenTokenToSessionId.get(displayToken)
        if (!mappedSessionId || mappedSessionId !== sessionId) throw new Error('displayToken invalide')
        if (!sessionMetaByEngineId.has(sessionId)) throw new Error('session introuvable')

        const data = socket.data as SocketData
        data.role = 'screen'
        data.sessionId = sessionId
        await socket.join(roomName(sessionId))
        reply({ ok: true })

        const session = await engine.getSession(sessionId)
        replayCurrentQuestionTo(socket, session)
      } catch (e) {
        reply({ error: message(e) })
      }
    })
  })
}
