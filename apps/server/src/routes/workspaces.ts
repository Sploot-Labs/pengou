import type { FastifyInstance } from 'fastify'
import { listUserWorkspaces, createWorkspace, type Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser } from '../require-user.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

const MAX_WORKSPACE_NAME = 80

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Routes de gestion des workspaces « pré-contexte » (Slice 3, sous-slice 3a) : lister ses
 * workspaces et en créer un. Elles tournent sur `systemDb` (bypass RLS) car elles précèdent — ou
 * traversent — le contexte tenant : on ne peut pas exiger un `x-tenant-id` pour DÉCOUVRIR ses
 * tenants. L'isolation est garantie par le filtre explicite sur `request.user.id`.
 */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, config } = deps

  // Liste des workspaces de l'utilisateur + le mode de tenancy (le client s'en sert pour
  // n'afficher le switcher qu'en multi).
  app.get('/api/workspaces', { preHandler: requireUser }, async (request) => {
    const workspaces = await listUserWorkspaces(systemDb, request.user.id)
    return { tenancyMode: config.tenancyMode, workspaces }
  })

  // Création d'un workspace : le créateur en devient owner. Indisponible en mode single (un seul
  // tenant `default` par conception self-host).
  app.post('/api/workspaces', { preHandler: requireUser }, async (request, reply) => {
    if (config.tenancyMode !== 'multi') {
      return reply.code(403).send({ error: 'La création de workspace est réservée au mode multi.' })
    }
    const body = request.body as { name?: unknown } | undefined
    if (!isNonEmptyString(body?.name)) {
      return reply.code(400).send({ error: 'Le nom du workspace est requis.' })
    }
    if (body.name.trim().length > MAX_WORKSPACE_NAME) {
      return reply.code(400).send({ error: `Le nom est trop long (${MAX_WORKSPACE_NAME} caractères max).` })
    }
    const workspace = await createWorkspace(systemDb, { name: body.name, ownerId: request.user.id })
    return reply.code(201).send(workspace)
  })
}
