import { KICKED_ACK_CODE } from './contracts'

/** Échec d'ack serveur (`{ error, code? }`). Le `code` est optionnel : seuls
 * certains refus (ex. exclusion) en portent un. */
export class AckError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'AckError'
  }
}

/** Vrai si l'erreur vient d'un refus pour exclusion. Test par propriété et non
 * par `instanceof` : les tests d'écran mockent `useGameSocket`. */
export function isKickedError(err: unknown): boolean {
  return hasAckCode(err, KICKED_ACK_CODE)
}

/** Vrai si l'erreur porte le code machine `code` (voir les `*_ACK_CODE` de contracts.ts). Test par
 * propriété, comme `isKickedError`. */
export function hasAckCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code
}
