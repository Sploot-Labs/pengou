import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Preuve de réception d'une invitation : HMAC du token, portée seulement par le lien envoyé par
 * e-mail (`?v=`). L'API ne la renvoie jamais : l'auteur de l'invitation, qui reçoit le token, ne
 * peut donc pas confirmer à la place du destinataire une adresse qu'il ne contrôle pas.
 */
export function invitationEmailProof(secret: string, token: string): string {
  return createHmac('sha256', secret).update(`invitation-email:${token}`).digest('base64url')
}

/** Compare en temps constant la preuve reçue à celle attendue pour ce token. */
export function isInvitationEmailProofValid(secret: string, token: string, proof: unknown): boolean {
  if (typeof proof !== 'string' || proof === '') return false
  const expected = Buffer.from(invitationEmailProof(secret, token))
  const received = Buffer.from(proof)
  return expected.length === received.length && timingSafeEqual(expected, received)
}
