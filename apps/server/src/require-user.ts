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

export async function requestScope(request: FastifyRequest, db: Db, config: AppConfig): Promise<TenantScope> {
  const explicitTenantId = typeof request.headers['x-tenant-id'] === 'string' ? (request.headers['x-tenant-id'] as string) : undefined
  const tenantId = await resolveTenantId(db, config, { userId: request.user.id, explicitTenantId })
  return tenantScope(db, tenantId)
}
