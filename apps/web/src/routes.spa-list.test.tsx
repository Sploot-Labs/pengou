// @vitest-environment jsdom
import type { RouteObject } from 'react-router-dom'
import { SPA_ROUTES } from '@splootlabs/shared/spa-routes'
import { describe, expect, it } from 'vitest'
import { router } from './routes'

function collectPaths(routes: readonly RouteObject[]): string[] {
  return routes.flatMap((route) => [...(route.path ? [route.path] : []), ...collectPaths(route.children ?? [])])
}

// Le serveur ne sert la page de l'application que sur les chemins de SPA_ROUTES et répond 404
// ailleurs (apps/server/src/static.ts). Une route ajoutée ici sans être ajoutée là-bas casserait
// le rechargement direct de la page ; ce test le signale.
describe('routes du serveur et du routeur', () => {
  it('concordent', () => {
    expect(collectPaths(router.routes).sort()).toEqual([...SPA_ROUTES].sort())
  })
})
