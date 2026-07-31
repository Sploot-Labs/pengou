import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)
afterAll(async () => { await ctx?.stop() })

async function signUp(app: FastifyInstance, email: string, name = 'Test'): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const raw = res.headers['set-cookie']
  return Array.isArray(raw) ? raw.map((c) => c.split(';')[0]).join('; ') : String(raw).split(';')[0]
}

async function buildApp(mode: 'single' | 'multi'): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: mode })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!', baseURL: 'http://localhost:3000', tenancyMode: config.tenancyMode,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
  return app
}

type WorkspacesResp = { tenancyMode: string; workspaces: Array<{ tenantId: string; slug: string; name: string; role: string }> }

describe('Slice 3 — workspaces (multi)', () => {
  it('signup multi crée un workspace perso owner ; GET /api/workspaces le liste', async () => {
    const app = await buildApp('multi')
    const cookie = await signUp(app, 'ws-a@example.com', 'Alice')
    const res = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as WorkspacesResp
    expect(body.tenancyMode).toBe('multi')
    expect(body.workspaces).toHaveLength(1)
    expect(body.workspaces[0].role).toBe('owner')
    expect(body.workspaces[0].name).toBe('Alice')
    await app.close()
  })

  it('GET /api/workspaces sans cookie → 401', async () => {
    const app = await buildApp('multi')
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST /api/workspaces crée un workspace (créateur owner)', async () => {
    const app = await buildApp('multi')
    const cookie = await signUp(app, 'ws-b@example.com', 'Bob')
    const create = await app.inject({
      method: 'POST', url: '/api/workspaces', payload: { name: 'Équipe Bob' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(create.statusCode).toBe(201)
    const list = (await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })).json() as WorkspacesResp
    expect(list.workspaces).toHaveLength(2)
    expect(list.workspaces.some((w) => w.name === 'Équipe Bob' && w.role === 'owner')).toBe(true)
    await app.close()
  })

  it('POST /api/workspaces en mode single → 403', async () => {
    const app = await buildApp('single')
    const cookie = await signUp(app, 'ws-single@example.com')
    const res = await app.inject({
      method: 'POST', url: '/api/workspaces', payload: { name: 'X' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('Slice 3 — invitations & membres (multi)', () => {
  it('flux complet : inviter → accepter → gérer les rôles + gardes', async () => {
    const app = await buildApp('multi')
    const ownerCookie = await signUp(app, 'inv-owner@example.com', 'Owner')
    const wsList = (await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: ownerCookie } })).json() as WorkspacesResp
    const tenantId = wsList.workspaces[0].tenantId

    // Invitation d'un membre.
    const invRes = await app.inject({
      method: 'POST', url: `/api/workspaces/${tenantId}/invitations`,
      payload: { email: 'guest@example.com', role: 'member' },
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
    })
    expect(invRes.statusCode).toBe(201)
    const token = (invRes.json() as { invitation: { token: string } }).invitation.token
    expect(token).toBeTruthy()

    // Le futur membre s'inscrit (obtient aussi son propre workspace perso).
    const guestCookie = await signUp(app, 'guest@example.com', 'Guest')

    // Preview de l'invitation.
    const preview = await app.inject({ method: 'GET', url: `/api/invitations/${token}`, headers: { cookie: guestCookie } })
    expect(preview.statusCode).toBe(200)
    expect((preview.json() as { workspaceName: string }).workspaceName).toBe('Owner')

    // Acceptation.
    const accept = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: guestCookie } })
    expect(accept.statusCode).toBe(200)
    expect((accept.json() as { tenantId: string; role: string }).role).toBe('member')

    // Le guest voit maintenant 2 workspaces (le sien + celui rejoint en member).
    const guestWs = (await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: guestCookie } })).json() as WorkspacesResp
    expect(guestWs.workspaces.some((w) => w.tenantId === tenantId && w.role === 'member')).toBe(true)

    // Ré-accepter le même token → 409 (déjà consommé).
    const reAccept = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: guestCookie } })
    expect(reAccept.statusCode).toBe(409)

    // L'owner liste 2 membres.
    const members = await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/members`, headers: { cookie: ownerCookie } })
    expect(members.statusCode).toBe(200)
    const memberList = (members.json() as { members: Array<{ email: string; role: string }> }).members
    expect(memberList).toHaveLength(2)

    // Un member (guest) NE PEUT PAS lister les membres → 403 (requirePermission).
    const guestForbidden = await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/members`, headers: { cookie: guestCookie } })
    expect(guestForbidden.statusCode).toBe(403)

    // L'owner promeut le guest admin.
    const guestUserId = memberList.find((m) => m.email === 'guest@example.com')
    expect(guestUserId).toBeTruthy()
    const guestId = (memberList as Array<{ email: string; userId: string; role: string }>).find((m) => m.email === 'guest@example.com')!.userId
    const promote = await app.inject({
      method: 'PATCH', url: `/api/workspaces/${tenantId}/members/${guestId}`,
      payload: { role: 'admin' }, headers: { 'content-type': 'application/json', cookie: ownerCookie },
    })
    expect(promote.statusCode).toBe(200)

    // Garde « ≥ 1 owner » : l'owner tente de se rétrograder → 409.
    const ownerId = (memberList as Array<{ email: string; userId: string }>).find((m) => m.email === 'inv-owner@example.com')!.userId
    const demoteSelf = await app.inject({
      method: 'PATCH', url: `/api/workspaces/${tenantId}/members/${ownerId}`,
      payload: { role: 'member' }, headers: { 'content-type': 'application/json', cookie: ownerCookie },
    })
    expect(demoteSelf.statusCode).toBe(409)

    // Un admin (guest promu) ne peut pas promouvoir quelqu'un vers owner (workspace:manage requis).
    const adminPromoteOwner = await app.inject({
      method: 'PATCH', url: `/api/workspaces/${tenantId}/members/${ownerId}`,
      payload: { role: 'owner' }, headers: { 'content-type': 'application/json', cookie: guestCookie },
    })
    // guest est admin → members:manage OK, mais toucher un owner exige workspace:manage → 403.
    expect(adminPromoteOwner.statusCode).toBe(403)

    // L'owner retire le guest.
    const remove = await app.inject({ method: 'DELETE', url: `/api/workspaces/${tenantId}/members/${guestId}`, headers: { cookie: ownerCookie } })
    expect(remove.statusCode).toBe(200)
    const after = (await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/members`, headers: { cookie: ownerCookie } })).json() as { members: unknown[] }
    expect(after.members).toHaveLength(1)

    await app.close()
  })

  it('non-membre → 403 sur la gestion d’un workspace étranger', async () => {
    const app = await buildApp('multi')
    const aCookie = await signUp(app, 'strangerA@example.com', 'StrangerA')
    const bCookie = await signUp(app, 'strangerB@example.com', 'StrangerB')
    const aWs = (await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: aCookie } })).json() as WorkspacesResp
    const aTenant = aWs.workspaces[0].tenantId
    const res = await app.inject({ method: 'GET', url: `/api/workspaces/${aTenant}/members`, headers: { cookie: bCookie } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
