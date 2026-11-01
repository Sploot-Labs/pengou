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
 * l'en-tête.
 */
export function clientIpFromRequest(req: IncomingMessage, trust: ReturnType<typeof compileTrust>): string {
  return proxyaddr(req, trust)
}
