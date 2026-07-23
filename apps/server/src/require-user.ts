import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import { resolveTenantId, tenantScope, type Db, type TenantScope } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import type { Auth } from '@splootlabs/auth'

declare module 'fastify' {
  interface FastifyRequest { user: { id: string; email: string } }
  interface FastifyInstance { auth: Auth }
}

export function registerRequireUser(app: FastifyInstance, auth: Auth): void {
  if (!app.hasDecorator('auth')) app.decorate('auth', auth)
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await request.server.auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
  if (!session?.user) { reply.code(401).send({ error: 'Non authentifié.' }); return }
  request.user = { id: session.user.id, email: session.user.email }
}

// Invariant : `requestScope` suppose que le preHandler `requireUser` a déjà tourné
// (donc `request.user` est renseigné). Garde défensive ci-dessous : sans ça, un appel
// erroné produirait un TypeError obscur (`Cannot read properties of undefined`) au lieu
// d'un message clair pointant vers la cause réelle.
export async function requestScope(request: FastifyRequest, db: Db, config: AppConfig): Promise<TenantScope> {
  if (!request.user?.id) throw new Error('requestScope requires requireUser preHandler')
  const explicitTenantId = typeof request.headers['x-tenant-id'] === 'string' ? (request.headers['x-tenant-id'] as string) : undefined
  const tenantId = await resolveTenantId(db, config, { userId: request.user.id, explicitTenantId })
  return tenantScope(db, tenantId)
}
