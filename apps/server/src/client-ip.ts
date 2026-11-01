import type { IncomingMessage } from 'node:http'
import proxyaddr from '@fastify/proxy-addr'

/**
 * Compile la liste TRUSTED_PROXIES (IP, CIDR, `loopback`, `linklocal`, `uniquelocal`) en
 * prédicat de confiance, au format attendu par proxy-addr (et par `trustProxy` de Fastify).
 * Une liste vide ne fait confiance à personne : X-Forwarded-For est alors ignoré.
 */
export function compileTrust(list: string[]): (addr: string, i: number) => boolean {
  return proxyaddr.compile(list)
}

/**
 * IP du client pour une requête Node brute (HTTP ou poignée de main Socket.IO), calculée comme
 * `request.ip` de Fastify : on part du pair TCP et on ne remonte X-Forwarded-For que tant que le
 * saut courant est un proxy de confiance. Un client ne peut donc pas choisir son IP en forgeant
 * l'en-tête. `undefined` si l'adresse du pair est inconnue.
 */
export function clientIpFromRequest(req: IncomingMessage, trust: ReturnType<typeof compileTrust>): string | undefined {
  // proxy-addr renvoie `undefined` si la socket TCP n'a plus d'adresse (connexion déjà fermée).
  return proxyaddr(req, trust) as string | undefined
}

/** Pairs privés ou loopback : ceux qui, en pratique, sont un reverse proxy oublié de la liste. */
const PAIR_PRIVE = proxyaddr.compile(['loopback', 'linklocal', 'uniquelocal'])

/**
 * Adresse du pair TCP quand il envoie X-Forwarded-For alors qu'il n'est pas dans TRUSTED_PROXIES
 * mais qu'il est privé ou loopback : très probablement un reverse proxy mal déclaré (l'en-tête est
 * alors ignoré et tous les clients partagent son IP). `undefined` sinon. Un pair public qui envoie
 * l'en-tête est un client ordinaire et n'est pas signalé.
 */
export function untrustedForwardingPeer(req: IncomingMessage, trust: ReturnType<typeof compileTrust>): string | undefined {
  if (req.headers['x-forwarded-for'] === undefined) return undefined
  const peer = req.socket?.remoteAddress
  if (!peer) return undefined
  if (trust(peer, 0) || !PAIR_PRIVE(peer, 0)) return undefined
  return peer
}

/**
 * Contrôle à appeler à chaque requête : journalise une seule fois (pour la durée de vie du
 * serveur, donc du processus) le premier pair repéré par `untrustedForwardingPeer`.
 */
export function createForwardedForWarner(
  trust: ReturnType<typeof compileTrust>,
  warn: (message: string) => void,
): (req: IncomingMessage) => void {
  let warned = false
  return (req) => {
    if (warned) return
    const peer = untrustedForwardingPeer(req, trust)
    if (peer === undefined) return
    warned = true
    warn(
      `X-Forwarded-For reçu d'un pair non approuvé (${peer}) : vérifiez TRUSTED_PROXIES, sinon tous les clients partagent la même IP pour les limites de débit.`,
    )
  }
}
