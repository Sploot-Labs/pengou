/**
 * Small typed fetch wrapper shared by every real API call the front makes
 * (auth in this task; quizzes/questions in Task 3; the rest of the CRUD
 * later). No external HTTP library — same-origin `fetch` is enough, and it
 * keeps the dev proxy (`vite.config.ts`) transparent: paths are always
 * relative (`/api/...`), so the browser resolves them against whatever
 * origin served the page (Vite dev server in dev, the Fastify process in
 * prod), and the `Origin` header Better Auth checks for CSRF is always the
 * real one.
 */

import { getActiveTenantId } from './activeTenant'

/** Thrown on any non-2xx response. `message` is the server's own error text
 * when the body carries one (Better Auth uses `{message}`, our own routes
 * use `{error}` — both are checked), else a generic fallback. */
export class ApiError extends Error {
  readonly status: number
  /** Code machine du serveur quand il en envoie un (`{code}`), ex. `TERMS_ACCEPTANCE_REQUIRED` ou `RESET_PASSWORD_DISABLED`. */
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Code des réponses 403 des routes protégées tant que l'hôte n'a pas accepté les CGU courantes. */
export const TERMS_ACCEPTANCE_REQUIRED = 'TERMS_ACCEPTANCE_REQUIRED'

const termsListeners = new Set<() => void>()

/** S'abonne aux refus « CGU à revalider » de n'importe quelle requête (une notification par
 * réponse). Utilisé par `SessionProvider` pour afficher l'écran de revalidation même quand le
 * changement de version survient après la sonde de session. Renvoie la fonction de désabonnement. */
export function onTermsAcceptanceRequired(listener: () => void): () => void {
  termsListeners.add(listener)
  return () => {
    termsListeners.delete(listener)
  }
}

function extractErrorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const code = (body as Record<string, unknown>).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return undefined
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    // Corps d'erreur par défaut de Fastify (`{statusCode, error: 'Not Found', message: 'Route GET:…'}`) :
    // libellés techniques en anglais, jamais destinés à l'utilisateur. Nos routes n'envoient pas
    // `statusCode`, Better Auth non plus.
    if (typeof record.statusCode === 'number') return undefined
    if (typeof record.error === 'string' && record.error.length > 0) return record.error
    if (typeof record.message === 'string' && record.message.length > 0) return record.message
  }
  return undefined
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Non-JSON body (e.g. an HTML error page from a proxy/500) — treated as
    // "no structured error" rather than crashing the caller.
    return undefined
  }
}

/** Message de repli quand la réponse ne porte aucun texte exploitable (proxy, page HTML, corps vide). */
function fallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return 'La demande est invalide.'
    case 401:
      return 'Votre session a expiré. Reconnectez-vous.'
    case 403:
      return "Vous n'avez pas les droits pour cette action."
    case 404:
      return 'Élément introuvable.'
    case 409:
      return 'Conflit avec une modification récente. Rechargez la page.'
    case 413:
      return 'Envoi trop volumineux.'
    case 429:
      return 'Trop de demandes. Patientez un instant puis réessayez.'
    case 502:
    case 503:
    case 504:
      return 'Le serveur ne répond pas. Réessayez dans un instant.'
  }
  if (status >= 500) return 'Le serveur a rencontré une erreur. Réessayez dans un instant.'
  return `Erreur ${status}`
}

function buildHeaders(withJsonBody: boolean): Record<string, string> {
  // Multi-tenant (Slice 3) : le workspace actif est porté par `x-tenant-id` sur CHAQUE requête.
  // En mode single (ou avant résolution du workspace), `getActiveTenantId()` renvoie null et
  // l'en-tête est omis — le serveur retombe sur le tenant `default`. C'est l'unique point
  // d'injection : toute la CRUD passe par `send()`.
  const tenantId = getActiveTenantId()
  const headers: Record<string, string> = {}
  if (withJsonBody) headers['Content-Type'] = 'application/json'
  if (tenantId) headers['x-tenant-id'] = tenantId
  return headers
}

async function send<T>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: BodyInit | undefined,
): Promise<T> {
  const response = await fetch(path, {
    method,
    // Always same-origin: no cross-origin auth calls are ever intended, and
    // this is what carries the Better Auth session cookie.
    credentials: 'same-origin',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body,
  })

  const text = await response.text()
  const data = text.length > 0 ? safeJsonParse(text) : undefined

  if (!response.ok) {
    const message = extractErrorMessage(data) ?? fallbackMessage(response.status)
    const code = extractErrorCode(data)
    if (response.status === 403 && code === TERMS_ACCEPTANCE_REQUIRED) {
      for (const listener of termsListeners) listener()
    }
    throw new ApiError(response.status, message, code)
  }

  return data as T
}

function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  return send<T>(method, path, buildHeaders(hasBody), hasBody ? JSON.stringify(body) : undefined)
}

/** Envoi multipart. Pas de `Content-Type` : le navigateur le pose avec la frontière. */
export function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return send<T>('POST', path, buildHeaders(false), form)
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}

/** Used by the question reorder endpoint (`PUT .../questions/order`) — the
 * only route so far that isn't GET/POST/PATCH/DELETE. */
export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body)
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('DELETE', path, body)
}
