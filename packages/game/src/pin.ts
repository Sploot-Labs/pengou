/**
 * Générateur de PIN par défaut : 6 chiffres, zéros non significatifs conservés (ex. "004213").
 * N'est PAS utilisé par le moteur lui-même (qui reçoit `genPin` en dépendance injectée pour
 * rester pur/déterministe) — c'est l'implémentation par défaut fournie aux appelants réels
 * (ex. la passerelle Socket.IO du Plan 5/Task 4).
 */
export function generatePin(): string {
  const n = Math.floor(Math.random() * 1_000_000)
  return n.toString().padStart(6, '0')
}
