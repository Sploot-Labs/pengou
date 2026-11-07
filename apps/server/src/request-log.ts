import { LogController, type FastifyReply, type FastifyRequest } from 'fastify'

// Journal des requêtes sans secret : les liens d'action (réinitialisation, confirmation,
// invitation) portent un jeton dans le chemin ou la query string, et Fastify journalise
// `req.url` à chaque requête. On ne garde que le chemin, segments à allure de jeton masqués.

const TOKEN_LIKE = /^[A-Za-z0-9_.-]{20,}$/
// Segments longs mais sans secret, utiles au diagnostic : routes en kebab-case et UUID.
const KEBAB_ROUTE = /^[a-z]+(-[a-z]+)*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Chemin de la requête sans query string, chaque segment à allure de jeton réduit à 6 caractères puis « … ». */
export function sanitizeLogUrl(url: string | undefined): string {
  if (!url) return ''
  const path = url.split(/[?#]/, 1)[0] ?? ''
  return path
    .split('/')
    .map((segment) =>
      TOKEN_LIKE.test(segment) && !KEBAB_ROUTE.test(segment) && !UUID.test(segment)
        ? `${segment.slice(0, 6)}…`
        : segment)
    .join('/')
}

type LoggedRequest = {
  method?: string
  url?: string
  host?: string
  ip?: string
  headers?: Record<string, unknown>
  socket?: { remotePort?: number }
}

/** Sérialiseur `req` de pino : celui de Fastify, avec une URL assainie. */
export function serializeRequest(req: LoggedRequest) {
  const version = req.headers?.['accept-version']
  return {
    method: req.method,
    url: sanitizeLogUrl(req.url),
    version: typeof version === 'string' ? version : undefined,
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  }
}

/**
 * Lignes internes de Fastify : seule « Route … not found » (gestionnaire 404 par défaut) cite
 * l'URL brute dans son message ; on y met l'URL assainie.
 */
export class SanitizedLogController extends LogController {
  override routeNotFound(request: FastifyRequest, _reply: FastifyReply): void {
    if (this.isLogDisabled(request)) return
    request.log.info(`Route ${request.raw.method}:${sanitizeLogUrl(request.raw.url)} not found`)
  }
}
