import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, ApiError } from './client'

/**
 * Auth layer — plain fetch against the documented Better Auth REST routes
 * (`/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`)
 * and the app's own session probe (`GET /api/me`), rather than Better Auth's
 * browser client (`better-auth/client`).
 *
 * Why: `better-auth/client` is not a dependency of `@splootlabs/web` today,
 * and adding it would mean carrying a second HTTP abstraction alongside the
 * `apiGet/apiPost` wrapper already needed for the quiz/question CRUD (Task
 * 3+). The three auth endpoints are simple JSON POSTs with a documented
 * shape (verified by hand against the running server below), so wrapping
 * them with the same client this module already uses is less surface area
 * for equivalent behaviour. If richer client features (social providers,
 * 2FA, plugins) are needed later, swapping this file for the real client is
 * a localized change — every screen only ever imports `signUp/signIn/
 * signOut/useSession` from here.
 */

export interface User {
  id: string
  email: string
  name?: string | null
  [key: string]: unknown
}

export interface SignUpInput {
  email: string
  password: string
  name: string
}

export interface SignInInput {
  email: string
  password: string
}

// Verified by hand against the running server (2026-07-23):
//   POST /api/auth/sign-up/email  → 200 {token, user}
//   POST /api/auth/sign-in/email  → 200 {redirect, token, user}
//   errors (400/401/422)          → {message, code} — no `error` field, hence
//                                    client.ts checking both `error` and `message`.
interface AuthEmailResponse {
  user: User
  token?: string
}

export async function signUp(input: SignUpInput): Promise<User> {
  const response = await apiPost<AuthEmailResponse>('/api/auth/sign-up/email', input)
  return response.user
}

export async function signIn(input: SignInInput): Promise<User> {
  const response = await apiPost<AuthEmailResponse>('/api/auth/sign-in/email', input)
  return response.user
}

export async function signOut(): Promise<void> {
  await apiPost('/api/auth/sign-out')
}

/** Session probe: `GET /api/me` → `{user}` when a session cookie is present,
 * `401 {error}` otherwise — the 401 case is expected (logged-out is normal),
 * so it resolves to `null` instead of throwing. Any other failure propagates. */
export async function fetchSession(): Promise<User | null> {
  try {
    const response = await apiGet<{ user: User }>('/api/me')
    return response.user
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export interface UseSessionResult {
  user: User | null
  loading: boolean
  /** Re-runs the session probe (e.g. after sign-in/sign-out) without a full reload. */
  refresh: () => Promise<void>
}

/** Session state for the whole app. Plain `useState`/`useEffect` — no state
 * library, per the task's constraints. Each caller gets its own probe (no
 * shared cache): acceptable at this app's size, and simpler than wiring a
 * context for a single `GET /api/me` call. */
export function useSession(): UseSessionResult {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const nextUser = await fetchSession()
      setUser(nextUser)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { user, loading, refresh }
}
