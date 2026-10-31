import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Button, Logo } from '../ui'
import '../tokens.css'
import '../prototype.css'

/**
 * Écran d'erreur du routeur (`errorElement` de la route racine), à la place de la page de
 * développement de react-router. Il remplace `AppShell` entier, donc il ne dépend d'aucun
 * provider (session, workspace) : c'est souvent l'un d'eux qui vient de lever.
 */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  if (!notFound) console.error(error)

  return (
    <ThemeProvider theme="app">
      <div className="prototype-root">
        <main className="join-screen" id="contenu-principal" tabIndex={-1}>
          <Logo />
          <p className="join-error" role="alert">
            {notFound
              ? "Cette page n'existe pas."
              : "Une erreur inattendue est survenue. Rechargez la page ; si le problème persiste, revenez à l'accueil."}
          </p>
          {!notFound && (
            <Button variant="primary" type="button" onClick={() => window.location.reload()}>
              Recharger la page
            </Button>
          )}
          <Link className="ab-button" to="/">
            ← Retour à l'accueil
          </Link>
        </main>
      </div>
    </ThemeProvider>
  )
}
