import type { GameSession, SubmittedAnswer } from './state.js'

export interface SessionStore {
  get(id: string): Promise<GameSession | undefined>
  /** Comme `get`, mais renvoie l'objet du cache SANS copie : lecture seule superficielle : ni l'objet
   * ni ses sous-objets ne doivent être modifiés (chemin chaud de `submitAnswer`, où la copie de toute la session coûtait cher). */
  peek(id: string): Promise<Readonly<GameSession> | undefined>
  /** Insère une copie de `submitted` dans `answers[round][playerId]` de la session en cache, sans
   * copier la session. Rejette si la session n'est pas en cache (appeler `peek` ou `get` avant). */
  recordAnswer(id: string, round: number, playerId: string, submitted: SubmittedAnswer): Promise<void>
  /** Sessions actives uniquement (voir décision "ended" ci-dessous). */
  getByPin(pin: string): Promise<GameSession | undefined>
  save(s: GameSession): Promise<void>
  delete(id: string): Promise<void>
  /** Retire une session du cache mémoire SANS persistance (retourne le PIN évincé, ou undefined).
   * Distinct de `delete` qui, lui, efface aussi l'état persistant. */
  evict(id: string): string | undefined
}

/**
 * Décision (ambiguïté du plan) : le plan ne définit un statut `ended` qu'à la couche
 * persistance (Task 3/db). Au niveau du moteur pur, on considère une session "terminée"
 * (donc son PIN libérable) dès qu'elle atteint la phase `podium` — c'est la seule phase
 * terminale de la machine à états `Phase`. `getByPin` ignore ces sessions afin que le PIN
 * puisse être réutilisé par une nouvelle partie, mais `get(id)` continue de les retrouver
 * (utile pour un rapport final / la persistance de clôture).
 */
const ENDED_PHASE = 'podium'

export class MemorySessionStore implements SessionStore {
  private readonly byId = new Map<string, GameSession>()
  private readonly pinToId = new Map<string, string>()

  async get(id: string): Promise<GameSession | undefined> {
    const session = this.byId.get(id)
    return session ? structuredClone(session) : undefined
  }

  async peek(id: string): Promise<Readonly<GameSession> | undefined> {
    return this.byId.get(id)
  }

  async recordAnswer(id: string, round: number, playerId: string, submitted: SubmittedAnswer): Promise<void> {
    const session = this.byId.get(id)
    if (!session) throw new Error(`recordAnswer: session ${id} absente du cache`)
    const forRound = session.answers[round] ?? {}
    forRound[playerId] = structuredClone(submitted)
    session.answers[round] = forRound
  }

  async getByPin(pin: string): Promise<GameSession | undefined> {
    const id = this.pinToId.get(pin)
    if (!id) return undefined
    const session = this.byId.get(id)
    if (!session || session.phase === ENDED_PHASE) return undefined
    return structuredClone(session)
  }

  async save(s: GameSession): Promise<void> {
    const clone = structuredClone(s)
    const previous = this.byId.get(s.id)
    if (previous && previous.pin !== clone.pin) this.pinToId.delete(previous.pin)
    this.byId.set(clone.id, clone)
    this.pinToId.set(clone.pin, clone.id)
  }

  async delete(id: string): Promise<void> {
    const session = this.byId.get(id)
    if (session) this.pinToId.delete(session.pin)
    this.byId.delete(id)
  }

  evict(id: string): string | undefined {
    const session = this.byId.get(id)
    if (!session) return undefined
    this.byId.delete(id)
    this.pinToId.delete(session.pin)
    return session.pin
  }
}
