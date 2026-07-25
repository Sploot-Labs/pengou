// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../AppShell'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SceneRoute } from '../routes'
import { Login } from '../screens/Login'

describe('AppShell', () => {
  it('pose data-theme="app" par défaut autour du contenu', () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>x</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-theme="app"]')).not.toBeNull()
  })

  // Task E1 : montage d'un vrai écran ADMIN (pas un enfant factice) pour
  // vérifier que le rôle `app` hérité par AppShell atteint bien un écran
  // concret. `Login` est le candidat le plus sûr : socket-free (ni
  // `GameSocketProvider` ni `SceneRoute` sur sa route dans `routes.tsx`), et
  // il ne déclenche aucun appel réseau à l'affichage — `useSession()` lit le
  // contexte posé par `SessionProvider` (déjà monté par `AppShell` ci-dessus)
  // et ne fait sa requête `GET /api/me` qu'en effet, capturée par le
  // `catch` interne de `SessionProvider.refresh` (voir `api/auth.tsx`) donc
  // sans crash même sans réseau/mock en environnement de test.
  it('un écran admin réel (Login) monté sous AppShell hérite data-theme="app"', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/login" element={<Login />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const appRoot = container.querySelector('[data-theme="app"]')
    expect(appRoot).not.toBeNull()
    // Vérifie que Login est bien À L'INTÉRIEUR de la racine `app`, pas
    // simplement un sibling — c'est l'écran réel qui doit hériter du rôle.
    expect(appRoot?.querySelector('#contenu-principal')).not.toBeNull()
  })
})

describe('SceneRoute', () => {
  // Le montage de /join via le vrai `router` (createBrowserRouter) entraîne
  // ses dépendances socket/provider réelles dans le test — fragile et hors
  // sujet ici. On teste directement le helper de wrapping utilisé par
  // routes.tsx pour /host/:sessionId, /play et /join (voir brief Task B1).
  it('pose data-theme="scene" data-scheme="dark" autour du contenu', () => {
    const { container } = render(
      <SceneRoute>
        <p>x</p>
      </SceneRoute>,
    )
    expect(
      container.querySelector('[data-theme="scene"][data-scheme="dark"]'),
    ).not.toBeNull()
  })
})
