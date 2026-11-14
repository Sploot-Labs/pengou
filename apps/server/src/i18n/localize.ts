import type { FastifyInstance } from 'fastify'
import { interpolate, isLang, matchLang, translate, type Lang, type Params } from '@splootlabs/shared/i18n'
import { authErrorKeys, csvCatalog, serverCatalog, type CsvKey } from './catalog.js'

type Headers = Record<string, string | string[] | undefined>

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value
}

/** `?lang=` valide d'abord, puis l'en-tête Accept-Language, puis 'fr'. */
export function langOf(request: { headers: Headers; query?: unknown }): Lang {
  const query = request.query
  if (query && typeof query === 'object') {
    const lang = (query as Record<string, unknown>).lang
    if (isLang(lang)) return lang
  }
  return matchLang(headerValue(request.headers['accept-language']))
}

/**
 * Langue d'une socket : `auth.lang` du handshake s'il est valide, sinon son Accept-Language, sinon 'fr'.
 * Sans `auth.lang` du tout, 'fr' : un onglet ouvert avant le déploiement des traductions compare
 * encore les textes français des acquittements, quelle que soit la langue de son navigateur.
 */
export function socketLang(handshake: { auth?: unknown; headers: Headers }): Lang {
  const auth = handshake.auth
  const lang = auth && typeof auth === 'object' ? (auth as Record<string, unknown>).lang : undefined
  if (lang === undefined) return 'fr'
  if (isLang(lang)) return lang
  return matchLang(headerValue(handshake.headers['accept-language']))
}

type Pattern = { key: string; names: string[]; regex: RegExp }

/** Clés à marqueurs compilées une fois : texte échappé, chaque `{nom}` capturant `(.+?)`, ancré. */
const PATTERNS: Pattern[] = Object.keys(serverCatalog.en)
  .filter((key) => /\{\w+\}/.test(key))
  .map((key) => {
    const names: string[] = []
    const source = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const marker = /^\{(\w+)\}$/.exec(part)
        if (marker) {
          names.push(marker[1] as string)
          return '(.+?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    return { key, names, regex: new RegExp(`^${source}$`, 's') }
  })

/** Correspondance exacte, puis clés à marqueurs ; inconnu : message inchangé. */
export function localizeMessage(message: string, lang: Lang): string {
  if (lang === 'fr') return message
  const catalog: Record<string, string> = serverCatalog[lang]
  if (Object.hasOwn(catalog, message)) return catalog[message] as string
  for (const { key, names, regex } of PATTERNS) {
    const match = regex.exec(message)
    if (!match) continue
    const params: Record<string, string> = {}
    names.forEach((name, index) => {
      params[name] = match[index + 1] as string
    })
    return interpolate(catalog[key] as string, params)
  }
  return message
}

/** Libellé du rapport CSV dans la langue demandée. */
export function csvLabel(lang: Lang, key: CsvKey, params?: Params): string {
  return translate(csvCatalog, lang, key, params)
}

/** Réponse JSON portant un champ `error` de type chaîne : champ traduit selon `langOf(request)`. */
function localizeErrorPayload(payload: string, lang: Lang): string {
  // Filtre bon marché avant de parser : la plupart des réponses n'ont pas d'erreur.
  if (!payload.includes('"error"')) return payload
  let body: unknown
  try {
    body = JSON.parse(payload)
  } catch {
    return payload
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return payload
  const error = (body as Record<string, unknown>).error
  if (typeof error !== 'string') return payload
  const translated = localizeMessage(error, lang)
  if (translated === error) return payload
  return JSON.stringify({ ...body, error: translated })
}

/**
 * Crochet onSend : une réponse JSON portant un champ `error` de type chaîne voit ce champ traduit
 * selon `langOf(request)`. Les autres réponses ne sont pas touchées. Crochet synchrone (forme à
 * rappel), voir app.ts : un crochet onSend asynchrone retarderait la réponse des gardes.
 *
 * Les routes `/api/auth/*` écrivent directement sur la réponse Node et échappent donc à ce crochet :
 * leurs messages sont traduits par `localizeAuthHandler`, voir auth-plugin.ts.
 */
export function registerErrorLocalization(app: FastifyInstance): void {
  app.addHook('onSend', (request, reply, payload, done) => {
    if (typeof payload !== 'string') return done(null, payload)
    const lang = langOf(request)
    if (lang === 'fr') return done(null, payload)
    const contentType = reply.getHeader('content-type')
    if (typeof contentType !== 'string' || !contentType.includes('application/json')) return done(null, payload)
    done(null, localizeErrorPayload(payload, lang))
  })
}

/** Message du limiteur de Better Auth, renvoyé sans code. */
const AUTH_RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.'

/** Message d'erreur de Better Auth traduit par son code ; un message français de Pengou (hooks
 * d'inscription) est traduit comme les autres messages du serveur ; sinon, inchangé. */
export function localizeAuthError(code: unknown, message: string, lang: Lang): string {
  const effectiveCode = typeof code === 'string' ? code : message === AUTH_RATE_LIMIT_MESSAGE ? 'TOO_MANY_REQUESTS' : ''
  if (Object.hasOwn(authErrorKeys, effectiveCode)) {
    return translate(serverCatalog, lang, authErrorKeys[effectiveCode] as string)
  }
  return localizeMessage(message, lang)
}

/** Langue d'une requête web (Better Auth) : mêmes règles que `langOf`. */
function langOfWebRequest(request: Request): Lang {
  const accept = request.headers.get('accept-language') ?? undefined
  let lang: string | null = null
  try {
    lang = new URL(request.url).searchParams.get('lang')
  } catch {
    // URL relative ou invalide : pas de paramètre.
  }
  return langOf({ headers: { 'accept-language': accept }, query: { lang } })
}

/**
 * Enveloppe le gestionnaire de Better Auth : une réponse d'erreur JSON `{ message, code }` voit son
 * message traduit dans la langue de la requête, français compris (Better Auth répond en anglais).
 * Le code, le statut et les en-têtes (cookies compris) ne changent pas ; une réponse réussie est
 * rendue telle quelle.
 */
export function localizeAuthHandler(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await handler(request)
    if (response.status < 400) return response
    if (!response.headers.get('content-type')?.includes('application/json')) return response
    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      return response
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response
    const record = body as Record<string, unknown>
    if (typeof record.message !== 'string') return response
    const translated = localizeAuthError(record.code, record.message, langOfWebRequest(request))
    if (translated === record.message) return response
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    return new Response(JSON.stringify({ ...record, message: translated }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}
