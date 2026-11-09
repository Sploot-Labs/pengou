import type { IncomingMessage } from 'node:http'
import proxyaddr from '@fastify/proxy-addr'
import { isIP } from 'node:net'

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
export function untrustedForwardingPeer(
  req: IncomingMessage,
  trust: ReturnType<typeof compileTrust>,
): string | undefined {
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

/** Développe une IPv6 (sans zone) en ses 8 groupes de 16 bits, ou `undefined` si elle est mal formée. */
function ipv6Groups(ip: string): number[] | undefined {
  const halves = ip.split('::')
  if (halves.length > 2) return undefined
  const parse = (part: string): number[] => {
    if (part === '') return []
    const groups: number[] = []
    for (const token of part.split(':')) {
      if (token.includes('.')) {
        const octets = token.split('.').map(Number)
        groups.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0))
      } else {
        groups.push(Number.parseInt(token, 16))
      }
    }
    return groups
  }
  const head = parse(halves[0] ?? '')
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : []
  const fill = 8 - head.length - tail.length
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return undefined
  return [...head, ...new Array<number>(fill).fill(0), ...tail]
}

/**
 * Clé du budget d'échecs de PIN pour une IP de client. Une IPv4, y compris mappée en IPv6
 * (`::ffff:a.b.c.d`), compte par adresse. Une IPv6 compte pour son préfixe /64 : un client en
 * dispose en général tout entier et pourrait sinon changer d'adresse à chaque essai.
 */
export function pinFailureKey(ip: string): string {
  const address = ip.split('%')[0] ?? ip
  if (isIP(address) !== 6) return ip
  const groups = ipv6Groups(address)
  if (!groups) return ip
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi = 0, lo = 0] = groups.slice(6)
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`
}
