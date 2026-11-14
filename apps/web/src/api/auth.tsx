import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { t } from '../i18n/t'
import { apiGet, apiPost, ApiError, onTermsAcceptanceRequired } from './client'

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
  emailVerified: boolean
  /** Hôte invité de la partie de démonstration : compte sans adresse, limité à l'écran hôte. */
  isAnonymous?: boolean | null
  [key: string]: unknown
}

export interface SignUpInput {
  email: string
  password: string
  name: string
  /** Version des CGU affichée et acceptée (instance avec CGU). Le serveur la compare à la sienne
   * et horodate lui-même l'acceptation. */
  acceptedTermsVersion?: string
  /** Case « J'ai 15 ans ou plus », exigée par le serveur avec les CGU. */
  ageConfirmed?: boolean
  /** Provenance de l'inscription (`?from=` du lien du site vitrine), enregistrée par le serveur. */
  from?: string
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

const VERIFIED_CALLBACK_URL = '/?email-verifie=1'

export async function signUp(input: SignUpInput): Promise<User> {
  // `callbackURL` : après clic sur le lien de confirmation, Better Auth ramène ici (et connecte).
  const response = await apiPost<AuthEmailResponse>('/api/auth/sign-up/email', {
    ...input,
    callbackURL: VERIFIED_CALLBACK_URL,
  })
  return response.user
}

export async function signIn(input: SignInInput): Promise<User> {
  const response = await apiPost<AuthEmailResponse>('/api/auth/sign-in/email', input)
  return response.user
}

/** Demande l'e-mail de réinitialisation. Better Auth redirige ensuite le lien reçu vers
 * `/reset-password?token=…` (ou `?error=INVALID_TOKEN`). */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiPost('/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })
}

/** Pose le nouveau mot de passe. 400 si le token est invalide ou expiré. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiPost('/api/auth/reset-password', { newPassword, token })
}

/** Renvoie l'e-mail de confirmation du compte connecté. `email` évite un aller-retour vers `/api/me`. */
export async function sendVerificationEmail(email?: string): Promise<void> {
  let address = email
  if (!address) {
    const probe = await fetchSession()
    if (!probe) throw new ApiError(401, t('Votre session a expiré. Reconnectez-vous.'))
    address = probe.user.email
  }
  await apiPost('/api/auth/send-verification-email', { email: address, callbackURL: VERIFIED_CALLBACK_URL })
}

export async function signOut(): Promise<void> {
  await apiPost('/api/auth/sign-out')
}

export interface SessionProbe {
  user: User
  /** Vrai si l'hôte doit accepter la version courante des CGU avant de continuer. */
  termsAcceptanceRequired: boolean
}

/** Session probe: `GET /api/me` → `{user, termsAcceptanceRequired}` when a session cookie is present,
 * `401 {error}` otherwise — the 401 case is expected (logged-out is normal),
 * so it resolves to `null` instead of throwing. Any other failure (5xx,
 * network blip, proxy hiccup) propagates to the caller, which MUST handle it
 * (see `SessionProvider.refresh` below) rather than let it surface as an
 * unhandled rejection. */
export async function fetchSession(): Promise<SessionProbe | null> {
  try {
    const response = await apiGet<{ user: User; termsAcceptanceRequired?: boolean }>('/api/me')
    return { user: response.user, termsAcceptanceRequired: response.termsAcceptanceRequired === true }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export interface UseSessionResult {
  user: User | null
  loading: boolean
  /** Set when the last `refresh()` failed for a reason other than "no
   * session" (401) — a transient 5xx/network/proxy failure. `user` is left
   * at its previous value (or `null` on the very first load) rather than
   * treated as a confirmed sign-out; a caller could use this to show a
   * retry affordance, though nothing does yet. */
  error: unknown
  /** Re-runs the session probe (e.g. after sign-in/sign-out) without a full reload. */
  refresh: () => Promise<void>
  /** Vrai quand l'hôte doit accepter les CGU courantes : signalé par `GET /api/me` ou par un 403
   * `TERMS_ACCEPTANCE_REQUIRED` sur une autre route. `<RequireAuth>` affiche alors l'écran de
   * revalidation à la place de l'écran protégé. */
  termsAcceptanceRequired: boolean
}

/**
 * Session state shared by the whole app via context — one `GET /api/me`
 * probe for the app's lifetime (plus explicit `refresh()` calls after
 * sign-in/sign-up/sign-out), not one per `useSession()` call site. This is
 * what lets `<RequireAuth>` avoid re-showing its loading interstitial when
 * navigating between two already-protected routes (e.g. `/` →
 * `/host/:sessionId`): both read the same resolved state instead of each
 * mounting its own probe.
 *
 * `SessionProvider` must be rendered once, above the router's routes (see
 * `AppShell.tsx`) — mounting it per-route would defeat the whole point.
 */
const SessionContext = createContext<UseSessionResult | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [termsAcceptanceRequired, setTermsAcceptanceRequired] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const probe = await fetchSession()
      setUser(probe?.user ?? null)
      setTermsAcceptanceRequired(probe?.termsAcceptanceRequired ?? false)
      setError(null)
    } catch (err) {
      // Transient failure, NOT the same as "logged out" (401 is already
      // handled inside fetchSession and never reaches this catch). Without
      // this catch, the rejection would escape `void refresh()` at the call
      // site below as an unhandled promise rejection on every 5xx/network
      // blip — exactly the kind of thing a proxy hiccup produces, and this
      // dev setup has one (see vite.config.ts). Treated as "no session for
      // now" rather than crashing; `error` is exposed for a future retry UI.
      setUser(null)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Version des CGU montée pendant la navigation : une route protégée répond 403, l'écran de
  // revalidation prend le relais sans attendre une nouvelle sonde.
  useEffect(() => onTermsAcceptanceRequired(() => setTermsAcceptanceRequired(true)), [])

  const value: UseSessionResult = { user, loading, error, refresh, termsAcceptanceRequired }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): UseSessionResult {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession() must be used within a <SessionProvider> (see AppShell.tsx)')
  }
  return ctx
}

/** Variante sans exigence de fournisseur : `null` hors de <SessionProvider>. Pour les composants
 * d'appoint montés dans des écrans qui, eux, ne dépendent pas de la session. */
export function useSessionOptional(): UseSessionResult | null {
  return useContext(SessionContext)
}
