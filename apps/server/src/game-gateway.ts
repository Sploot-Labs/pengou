import type { Server, Socket } from 'socket.io'
import { fromNodeHeaders } from 'better-auth/node'
import {
  resolveTenantId, tenantScope, listQuestions,
  createGameSession, addSessionPlayer, recordAnswer, setSessionStatus, setPlayerScore,
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
   * (ou son alias host:skip) est invoqué plusieurs fois sur la même manche. */
  revealedRounds: Set<number>
  /** `game_session.status` ne passe à 'active' qu'une seule fois (au premier host:start) :
   * un ré-appel écraserait sinon `startedAt` à chaque question suivante. */
  statusActiveSet: boolean
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

function toEngineQuestion(row: { id: string; type: string; prompt: string; timeLimit: number; payload: unknown }): EngineQuestion {
  return {
    id: row.id,
    type: row.type as EngineQuestion['type'],
    prompt: row.prompt,
    timeLimit: row.timeLimit,
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
  // Token d'affichage grand écran : à usage unique (consommé au premier screen:join réussi),
  // au niveau de la passerelle (pas du moteur — c'est un concept de transport, pas d'état de jeu).
  const screenTokenToSessionId = new Map<string, string>()
  // Socket ACTUELLEMENT actif pour chaque joueur (mis à jour par player:join ET player:reconnect).
  // Garde contre la course reconnexion-rapide : Socket.IO peut détecter la coupure d'un socket
  // mort jusqu'à ~pingTimeout après qu'un nouveau socket ait déjà repris le même joueur via
  // player:reconnect — sans cette Map, le `disconnect` tardif de l'ANCIEN socket écraserait
  // `connected:false` sur un joueur pourtant déjà reconnecté.
  const activeSocketIdByPlayerId = new Map<string, string>()

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

  /** Commun à `host:reveal` et `host:skip` (Task 4 : le plan mentionne les deux événements mais
   * ne décrit qu'un mapping engine reveal+scoreboard — `skip` est traité comme une révélation
   * anticipée forcée par l'hôte, sans attendre la fin du chrono). */
  async function doReveal(socket: Socket, ack?: (res: unknown) => void): Promise<void> {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const { sessionId, meta } = requireHost(socket)
      const revealed = await engine.reveal(sessionId)
      await persistRound(meta, revealed)

      // Anti-triche : `questionResult` (qui contient la bonne réponse) n'est calculé qu'ICI,
      // strictement après engine.reveal() — jamais avant, jamais pour `question:show`.
      const result = engine.questionResult(revealed)
      io.to(roomName(sessionId)).emit('question:reveal', result)

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
        const session = await engine.createSession({
          quizId,
          tenantId,
          hostId: authSession.user.id,
          questions,
        })

        const dbSession = await createGameSession(scope, { quizId, hostId: authSession.user.id, pin: session.pin })
        if (!dbSession) throw new Error('création de la session impossible')

        sessionMetaByEngineId.set(session.id, {
          dbSessionId: dbSession.id,
          tenantId,
          playerDbIds: new Map(),
          revealedRounds: new Set(),
          statusActiveSet: false,
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

    socket.on('host:start', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = requireHost(socket)
        const session = await engine.startQuestion(sessionId)
        if (!meta.statusActiveSet) {
          await setSessionStatus(db, meta.dbSessionId, 'active')
          meta.statusActiveSet = true
        }
        // Anti-triche : SEULE la projection joueur (sans la bonne réponse) est diffusée ici,
        // à TOUTE la room (hôte + joueurs + grand écran) — jamais `questionResult`.
        const view = engine.playerQuestionView(session)
        io.to(roomName(sessionId)).emit('question:show', view)
        emitTimer(sessionId, session)
        reply(view)
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    // Garde `host:reveal` hors phase question (ex. juste après host:create, encore en lobby) :
    // sans ce garde, engine.reveal() ferait quand même avancer la phase et émettrait un
    // `question:reveal { correct: undefined }` / `scoreboard` bidon (aucune question courante).
    // Volontairement PAS dans `doReveal` (partagé avec host:skip, qu'on ne doit pas modifier) :
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
    socket.on('host:skip', (_payload: unknown, ack?: (res: unknown) => void) => void doReveal(socket, ack))

    socket.on('host:next', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = requireHost(socket)
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
        const session = await engine.nextQuestion(sessionId)
        if (session.phase === 'podium') {
          await setSessionStatus(db, meta.dbSessionId, 'ended')
          const top = engine.ranking(session).slice(0, 3)
          io.to(roomName(sessionId)).emit('podium', { top })
        } else {
          const view = engine.playerQuestionView(session)
          io.to(roomName(sessionId)).emit('question:show', view)
          emitTimer(sessionId, session)
        }
        reply({ phase: session.phase })
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

        reply({ playerId: player.id, phase: session.phase, score: player.score })
        io.to(roomName(sessionId)).emit('lobby:update', { players: playersPayload(session) })

        // Un joueur qui reconnecte EN PLEINE QUESTION doit pouvoir la voir/y répondre tout de
        // suite, pas seulement à partir de la question suivante : on lui renvoie, à LUI SEUL
        // (pas à la room — les autres l'ont déjà reçu), la même projection anti-triche que
        // host:start/host:next (`playerQuestionView`, jamais `questionResult`) + le `timer`.
        if (session.phase === 'question') {
          const view = engine.playerQuestionView(session)
          socket.emit('question:show', view)
          const timer = timerPayload(session)
          if (timer) socket.emit('timer', timer)
        }
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
        // Usage unique : consommé dès qu'on le trouve, AVANT toute autre vérification, pour
        // qu'un token trouvé mais menant à une session introuvable ne reste pas réutilisable.
        screenTokenToSessionId.delete(displayToken)
        if (!sessionMetaByEngineId.has(sessionId)) throw new Error('session introuvable')

        const data = socket.data as SocketData
        data.role = 'screen'
        data.sessionId = sessionId
        await socket.join(roomName(sessionId))
        reply({ ok: true })
      } catch (e) {
        reply({ error: message(e) })
      }
    })
  })
}
