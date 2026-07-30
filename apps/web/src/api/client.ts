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

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  // Multi-tenant (Slice 3) : le workspace actif est porté par `x-tenant-id` sur CHAQUE requête.
  // En mode single (ou avant résolution du workspace), `getActiveTenantId()` renvoie null et
  // l'en-tête est omis — le serveur retombe sur le tenant `default`. C'est l'unique point
  // d'injection : toute la CRUD passe par `request()`.
  const tenantId = getActiveTenantId()
  const headers: Record<string, string> = {}
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (tenantId) headers['x-tenant-id'] = tenantId

  const response = await fetch(path, {
    method,
    // Always same-origin: no cross-origin auth calls are ever intended, and
    // this is what carries the Better Auth session cookie.
    credentials: 'same-origin',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const data = text.length > 0 ? safeJsonParse(text) : undefined

  if (!response.ok) {
    const message = extractErrorMessage(data) ?? `Erreur ${response.status}`
    throw new ApiError(response.status, message)
  }

  return data as T
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
