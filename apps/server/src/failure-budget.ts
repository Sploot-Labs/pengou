/**
 * Budget d'échecs par clé (ici l'IP du client), sur une fenêtre fixe : la fenêtre s'ouvre au
 * premier échec et la clé est bloquée dès que `max` échecs y sont comptés, jusqu'à son expiration.
 * Seuls les échecs comptent, si bien qu'un usage légitime (même nombreux, derrière un NAT) ne
 * consomme rien.
 *
 * La Map garde ses clés dans l'ordre d'ouverture de leur fenêtre (une fenêtre rouverte réinsère
 * sa clé en fin de Map) : les clés expirées sont donc en tête, purgées au fil des accès, et la
 * plus ancienne est évincée quand `maxKeys` est atteint. La mémoire reste bornée face à un
 * attaquant qui multiplie les clés.
 */
export class FailureBudget {
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly maxKeys: number
  private readonly entries = new Map<string, { start: number; count: number }>()

  constructor(opts: { max: number; windowMs: number; now?: () => number; maxKeys?: number }) {
    this.max = opts.max
    this.windowMs = opts.windowMs
    this.now = opts.now ?? Date.now
    this.maxKeys = opts.maxKeys ?? 10_000
  }

  /** Nombre de clés suivies (fenêtres non encore purgées). */
  get size(): number {
    return this.entries.size
  }

  isBlocked(key: string): boolean {
    const now = this.now()
    this.purge(now)
    const entry = this.entries.get(key)
    return entry !== undefined && entry.count >= this.max
  }

  recordFailure(key: string): void {
    const now = this.now()
    this.purge(now)
    const entry = this.entries.get(key)
    if (entry) {
      entry.count += 1
      return
    }
    if (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { start: now, count: 1 })
  }

  /** Retire les fenêtres expirées, toutes en tête de Map (ordre d'ouverture). */
  private purge(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.start < this.windowMs) break
      this.entries.delete(key)
    }
  }
}
