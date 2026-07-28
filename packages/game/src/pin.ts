import { randomInt } from 'node:crypto'

/**
 * Générateur de PIN par défaut : 6 chiffres, zéros non significatifs conservés (ex. "004213").
 * N'est PAS utilisé par le moteur lui-même (qui reçoit `genPin` en dépendance injectée pour
 * rester pur/déterministe) — c'est l'implémentation par défaut fournie aux appelants réels
 * (ex. la passerelle Socket.IO du Plan 5/Task 4).
 *
 * Sécurité (P1) : `crypto.randomInt` (CSPRNG) plutôt que `Math.random` — un PRNG non
 * cryptographique rend les PIN prédictibles/biaisés, ce qui facilite l'énumération des parties
 * en cours (rejoindre la partie d'un inconnu). `randomInt` tire uniformément sur [0, 1_000_000[.
 */
export function generatePin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}
