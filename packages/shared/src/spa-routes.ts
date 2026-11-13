/**
 * Routes de l'application web (SPA), au format de react-router (`:param` = un segment non vide).
 *
 * Le serveur ne sert la page de l'application que sur ces chemins ; tout autre chemin répond 404,
 * pour que les moteurs et les outils ne prennent pas une URL inventée pour une vraie page. La liste
 * doit suivre `apps/web/src/routes.tsx` : un test côté web vérifie qu'elles concordent.
 */
export const SPA_ROUTES = [
  '/',
  '/login',
  '/signup',
  '/demo',
  '/forgot-password',
  '/reset-password',
  '/quizzes/:quizId',
  '/library',
  '/host/:sessionId',
  '/sessions/:sessionId',
  '/workspace',
  '/invitations/:token',
  '/join',
  '/play',
  '/screen/:sessionId',
  '/credits',
] as const

const COMPILED = SPA_ROUTES.map((route) => route.toLowerCase().split('/').filter(Boolean))

/**
 * Vrai si le chemin (sans query) correspond à une route de l'application. Une barre finale est
 * tolérée et la casse ignorée, comme dans react-router par défaut.
 */
export function isSpaRoute(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false
  const parts = pathname.toLowerCase().split('/').slice(1)
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  if (parts.some((part) => part === '')) return false
  return COMPILED.some(
    (route) =>
      route.length === parts.length && route.every((seg, i) => (seg.startsWith(':') ? true : seg === parts[i])),
  )
}
