import type { Db } from '@splootlabs/db'
import { saveEngineState, loadEngineState, loadEngineStateByPin, clearEngineState } from '@splootlabs/db'
import type { GameSession, SessionStore, SubmittedAnswer } from '@splootlabs/game'

/** Voir `packages/game/src/store.ts` (MemorySessionStore) : même décision — un PIN reste
 * associable jusqu'à ce que la session atteigne la phase terminale `podium`. */
const ENDED_PHASE = 'podium'

// `answers`/`credited` sont indexés par numéro de question (Record<number, …>) côté moteur,
// mais jsonb sérialise ces clés en chaînes — on les re-parse en nombres à la lecture.
function deserialize(raw: unknown): GameSession {
  const s = raw as GameSession
  return {
    ...s,
    answers: Object.fromEntries(
      Object.entries(s.answers ?? {}).map(([k, v]) => [Number(k), v]),
    ),
    credited: Object.fromEntries(
      Object.entries(s.credited ?? {}).map(([k, v]) => [Number(k), v]),
    ),
  }
}

/**
 * `SessionStore` avec cache en mémoire (Map) + écriture systématique (write-through) vers
 * Postgres via les helpers `engine_state` du repo `session` (Task 1). Le cache accélère les
 * lectures du process courant ; la base permet à un process neuf (redémarrage/reprise) de
 * relire l'état — d'où l'unification d'id GameSession ↔ game_session (Task 2) : `save` échoue
 * silencieusement (0 ligne affectée) si la ligne `game_session` n'existe pas encore.
 */
export class PersistentSessionStore implements SessionStore {
  private readonly byId = new Map<string, GameSession>()
  private readonly pinToId = new Map<string, string>()
  // Coalescence des écritures DB (P0-5) : signature du dernier état PERSISTÉ + minuteur en attente
  // par session. Le cache mémoire (`byId`) est toujours à jour immédiatement ; seule l'écriture
  // Postgres est débouncée pour les changements « answers-only ».
  private readonly lastPersistedSig = new Map<string, string>()
  private readonly pendingFlush = new Map<string, ReturnType<typeof setTimeout>>()
  private static readonly FLUSH_DELAY_MS = 250

  constructor(private readonly db: Db) {}

  /** Signature des champs dont un changement rend l'écriture CRITIQUE (durabilité immédiate) :
   * phase, index de manche, ensemble des manches créditées, ensemble des joueurs. Un changement
   * « answers-only » (réponses accumulées d'une manche non révélée) ne modifie AUCUN de ces champs
   * → écriture coalescée. Le crédit (scoring) et les transitions de phase restent, eux, durables
   * immédiatement — condition de la cicatrisation P1-8 et de l'idempotence du reveal. */
  private signature(s: GameSession): string {
    const creditedRounds = Object.keys(s.credited ?? {}).filter((k) => s.credited[Number(k)]).sort()
    const players = Object.keys(s.players ?? {}).sort()
    return JSON.stringify({ phase: s.phase, idx: s.currentIndex, creditedRounds, players })
  }

  private scheduleFlush(id: string): void {
    if (this.pendingFlush.has(id)) return
    const timer = setTimeout(() => {
      void this.flush(id).catch(() => {})
    }, PersistentSessionStore.FLUSH_DELAY_MS)
    timer.unref() // ne maintient pas le process en vie ; l'arrêt gracieux appelle flushAll().
    this.pendingFlush.set(id, timer)
  }

  /** Écrit immédiatement l'état COURANT (cache) en base et met à jour la signature persistée. */
  private async flush(id: string): Promise<void> {
    const pending = this.pendingFlush.get(id)
    if (pending) {
      clearTimeout(pending)
      this.pendingFlush.delete(id)
    }
    const s = this.byId.get(id)
    if (!s) return
    await saveEngineState(this.db, id, s)
    this.lastPersistedSig.set(id, this.signature(s))
  }

  /** Persiste immédiatement tous les états en attente (arrêt gracieux — voir onClose serveur).
   * Sans ça, un `docker stop` pourrait perdre les dernières réponses coalescées d'une manche. */
  async flushAll(): Promise<void> {
    for (const id of [...this.pendingFlush.keys()]) await this.flush(id)
  }

  async get(id: string): Promise<GameSession | undefined> {
    const cached = this.byId.get(id)
    if (cached) return structuredClone(cached)

    const raw = await loadEngineState(this.db, id)
    if (!raw) return undefined
    const session = deserialize(raw)
    this.index(session)
    return structuredClone(session)
  }

  /** Lecture sans copie (lecture seule) : renvoie l'objet du cache, chargé depuis la base si absent. */
  async peek(id: string): Promise<Readonly<GameSession> | undefined> {
    const cached = this.byId.get(id)
    if (cached) return cached

    const raw = await loadEngineState(this.db, id)
    if (!raw) return undefined
    this.index(deserialize(raw))
    return this.byId.get(id)
  }

  /** Enregistre une réponse dans le cache sans copier la session. Une réponse ne change ni la phase,
   * ni la manche, ni les crédits, ni les joueurs : la signature est inchangée, donc écriture coalescée. */
  async recordAnswer(id: string, round: number, playerId: string, submitted: SubmittedAnswer): Promise<void> {
    const session = this.byId.get(id)
    if (!session) throw new Error(`recordAnswer: session ${id} absente du cache`)
    const forRound = session.answers[round] ?? {}
    forRound[playerId] = structuredClone(submitted)
    session.answers[round] = forRound
    this.scheduleFlush(id)
  }

  async getByPin(pin: string): Promise<GameSession | undefined> {
    const cachedId = this.pinToId.get(pin)
    const cached = cachedId ? this.byId.get(cachedId) : undefined
    if (cached && cached.phase !== ENDED_PHASE) return structuredClone(cached)

    const raw = await loadEngineStateByPin(this.db, pin)
    if (!raw) return undefined
    const session = deserialize(raw)
    this.index(session)
    return structuredClone(session)
  }

  async save(s: GameSession): Promise<void> {
    const clone = structuredClone(s)
    const previous = this.byId.get(s.id)
    if (previous && previous.pin !== clone.pin) this.pinToId.delete(previous.pin)
    this.byId.set(clone.id, clone) // cache TOUJOURS à jour immédiatement
    this.pinToId.set(clone.pin, clone.id)

    // Écriture DB : immédiate si CRITIQUE (1re écriture, ou changement de phase/manche/crédit/
    // joueurs), coalescée sinon (« answers-only »). Réduit l'amplification O(n²) du blob
    // write-through quand N joueurs répondent à la même manche.
    if (this.lastPersistedSig.get(s.id) !== this.signature(clone)) {
      await this.flush(s.id)
    } else {
      this.scheduleFlush(s.id)
    }
  }

  async delete(id: string): Promise<void> {
    const pending = this.pendingFlush.get(id)
    if (pending) {
      clearTimeout(pending)
      this.pendingFlush.delete(id)
    }
    this.lastPersistedSig.delete(id)
    const session = this.byId.get(id)
    if (session) this.pinToId.delete(session.pin)
    this.byId.delete(id)
    await clearEngineState(this.db, id)
  }

  /** Éviction cache uniquement : le balayage d'abandon (`sweepAbandonedSessions`, game-gateway)
   * a déjà mis `engine_state` à null via l'UPDATE SQL — inutile de réécrire en base ici. */
  evict(id: string): string | undefined {
    const session = this.byId.get(id)
    if (!session) return undefined
    this.byId.delete(id)
    this.pinToId.delete(session.pin)
    return session.pin
  }

  private index(session: GameSession): void {
    this.byId.set(session.id, structuredClone(session))
    this.pinToId.set(session.pin, session.id)
  }
}
