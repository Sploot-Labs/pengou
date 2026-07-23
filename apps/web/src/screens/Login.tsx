import { Link } from 'react-router-dom'
import { Logo } from '../ui'

/**
 * Placeholder — Task 2 remplace ce panneau par le vrai formulaire de
 * connexion (client Better Auth). Il existe ici uniquement pour que la
 * route /login résolve et reste on-brand en attendant.
 */
export function Login() {
  return (
    <main className="join-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />
      <div className="join-card">
        <h1>Connexion</h1>
        <p style={{ color: 'var(--ink-dim)' }}>
          L'écran de connexion arrive bientôt.
        </p>
        <p>
          <Link to="/">Retour à l'accueil</Link>
        </p>
      </div>
    </main>
  )
}
