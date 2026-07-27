import type { Db } from '@splootlabs/db'
import { saveEngineState, loadEngineState, loadEngineStateByPin, clearEngineState } from '@splootlabs/db'
import type { GameSession, SessionStore } from '@splootlabs/game'

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

  constructor(private readonly db: Db) {}

  async get(id: string): Promise<GameSession | undefined> {
    const cached = this.byId.get(id)
    if (cached) return structuredClone(cached)

    const raw = await loadEngineState(this.db, id)
    if (!raw) return undefined
    const session = deserialize(raw)
    this.index(session)
    return structuredClone(session)
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
    this.byId.set(clone.id, clone)
    this.pinToId.set(clone.pin, clone.id)
    // jsonb accepte l'objet tel quel (mêmes clés numériques-en-chaînes que `deserialize` re-parse).
    await saveEngineState(this.db, s.id, clone)
  }

  async delete(id: string): Promise<void> {
    const session = this.byId.get(id)
    if (session) this.pinToId.delete(session.pin)
    this.byId.delete(id)
    await clearEngineState(this.db, id)
  }

  private index(session: GameSession): void {
    this.byId.set(session.id, structuredClone(session))
    this.pinToId.set(session.pin, session.id)
  }
}
