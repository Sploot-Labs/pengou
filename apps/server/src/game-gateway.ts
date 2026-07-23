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
        reply(view)
      } catch (e) {
        reply({ error: message(e) })
      }
    })

    socket.on('host:reveal', (_payload: unknown, ack?: (res: unknown) => void) => void doReveal(socket, ack))
    socket.on('host:skip', (_payload: unknown, ack?: (res: unknown) => void) => void doReveal(socket, ack))

    socket.on('host:next', async (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const { sessionId, meta } = requireHost(socket)
        const session = await engine.nextQuestion(sessionId)
        if (session.phase === 'podium') {
          await setSessionStatus(db, meta.dbSessionId, 'ended')
          const top = engine.ranking(session).slice(0, 3)
          io.to(roomName(sessionId)).emit('podium', { top })
        } else {
          const view = engine.playerQuestionView(session)
          io.to(roomName(sessionId)).emit('question:show', view)
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
        reply(result)
      } catch (e) {
        reply({ accepted: false, error: message(e) })
      }
    })

    // Reconnexion (join_token) : Task 5. Stub qui ne casse pas le build/les autres flux —
    // ne renvoie jamais d'état de jeu tant que l'implémentation réelle n'est pas là.
    socket.on('player:reconnect', (_payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      reply({ error: 'reconnexion pas encore implémentée (Task 5)' })
    })

    // Grand écran : pour cette tâche, un simple join en lecture seule à la room de session
    // (le token d'affichage à usage unique est ajouté au Task 5).
    socket.on('screen:join', async (payload: { sessionId?: unknown } | undefined, ack?: (res: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const sessionId = payload?.sessionId
        if (typeof sessionId !== 'string' || !sessionMetaByEngineId.has(sessionId)) {
          throw new Error('session introuvable')
        }
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
