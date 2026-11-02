import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
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

describe('invitations : auteur qui perd members:manage (multi)', () => {
  const json = { 'content-type': 'application/json' }

  /** O crée W, invite A en admin, A accepte ; A crée une invitation admin et en garde le jeton. */
  async function setup(app: FastifyInstance, tag: string) {
    const oCookie = await signUp(app, `${tag}-o@x.test`, 'Owner')
    const tenantId = ((await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: oCookie } })).json() as WorkspacesResp).workspaces[0].tenantId
    const inv = await app.inject({
      method: 'POST', url: `/api/workspaces/${tenantId}/invitations`,
      payload: { email: `${tag}-a@x.test`, role: 'admin' }, headers: { ...json, cookie: oCookie },
    })
    const aCookie = await signUp(app, `${tag}-a@x.test`, 'Admin')
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${(inv.json() as { invitation: { token: string } }).invitation.token}/accept`, headers: { cookie: aCookie } })
    expect(acc.statusCode).toBe(200)
    const members = (await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/members`, headers: { cookie: oCookie } })).json() as { members: Array<{ email: string; userId: string }> }
    const aId = members.members.find((m) => m.email === `${tag}-a@x.test`)!.userId
    const aInv = await app.inject({
      method: 'POST', url: `/api/workspaces/${tenantId}/invitations`,
      payload: { email: `${tag}-d@x.test`, role: 'admin' }, headers: { ...json, cookie: aCookie },
    })
    expect(aInv.statusCode).toBe(201)
    const token = (aInv.json() as { invitation: { token: string } }).invitation.token
    return { oCookie, aCookie, aId, tenantId, token }
  }

  it('un admin retiré ne peut pas accepter une invitation qu\'il a créée', async () => {
    const app = await buildApp('multi')
    const { oCookie, aCookie, aId, tenantId, token } = await setup(app, 't1a')
    const del = await app.inject({ method: 'DELETE', url: `/api/workspaces/${tenantId}/members/${aId}`, headers: { cookie: oCookie } })
    expect(del.statusCode).toBe(200)
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: aCookie } })
    expect(acc.statusCode).toBe(409)
    const list = await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/members`, headers: { cookie: aCookie } })
    expect(list.statusCode).toBe(403)
    const rows = await ctx.db.select().from(schema.membership)
      .where(and(eq(schema.membership.userId, aId), eq(schema.membership.tenantId, tenantId)))
    expect(rows).toHaveLength(0)
    await app.close()
  })

  it('le retrait d\'un admin révoque ses invitations en attente', async () => {
    const app = await buildApp('multi')
    const { oCookie, aId, tenantId, token } = await setup(app, 't1b')
    await app.inject({ method: 'DELETE', url: `/api/workspaces/${tenantId}/members/${aId}`, headers: { cookie: oCookie } })
    const res = await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/invitations`, headers: { cookie: oCookie } })
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json())).not.toContain(token)
    await app.close()
  })

  it('rétrograder un admin en member révoque ses invitations en attente', async () => {
    const app = await buildApp('multi')
    const { oCookie, aId, tenantId, token } = await setup(app, 't1c')
    const patch = await app.inject({
      method: 'PATCH', url: `/api/workspaces/${tenantId}/members/${aId}`,
      payload: { role: 'member' }, headers: { ...json, cookie: oCookie },
    })
    expect(patch.statusCode).toBe(200)
    const d2Cookie = await signUp(app, 't1c-d@x.test', 'D2')
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: d2Cookie } })
    expect(acc.statusCode).toBe(409)
    const rows = await ctx.db.select().from(schema.membership).where(eq(schema.membership.tenantId, tenantId))
    expect(rows).toHaveLength(2)
    await app.close()
  })

  it('une invitation d\'un admin toujours en place reste acceptable', async () => {
    const app = await buildApp('multi')
    const { tenantId, token } = await setup(app, 't1d')
    const dCookie = await signUp(app, 't1d-d@x.test', 'D')
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: dCookie } })
    expect(acc.statusCode).toBe(200)
    expect(acc.json()).toMatchObject({ tenantId, role: 'admin' })
    await app.close()
  })

  it('la liste des invitations en attente ne renvoie aucun jeton', async () => {
    const app = await buildApp('multi')
    const { oCookie, tenantId, token } = await setup(app, 't8a')
    const res = await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/invitations`, headers: { cookie: oCookie } })
    expect(res.statusCode).toBe(200)
    const { invitations } = res.json() as { invitations: Array<Record<string, unknown>> }
    expect(invitations.length).toBeGreaterThan(0)
    for (const inv of invitations) expect(inv).not.toHaveProperty('token')
    expect(res.body).not.toContain(token)
    await app.close()
  })

  it("un admin qui régénère l'invitation du propriétaire puis est retiré ne peut pas l'accepter", async () => {
    const app = await buildApp('multi')
    const { oCookie, aCookie, aId, tenantId } = await setup(app, 't8b')
    const ownerInv = await app.inject({
      method: 'POST', url: `/api/workspaces/${tenantId}/invitations`,
      payload: { email: 't8b-e@x.test', role: 'admin' }, headers: { ...json, cookie: oCookie },
    })
    expect(ownerInv.statusCode).toBe(201)
    const invId = (ownerInv.json() as { invitation: { id: string } }).invitation.id
    const resent = await app.inject({ method: 'POST', url: `/api/workspaces/${tenantId}/invitations/${invId}/resend`, headers: { cookie: aCookie } })
    expect(resent.statusCode).toBe(200)
    const token = (resent.json() as { invitation: { token: string } }).invitation.token
    const del = await app.inject({ method: 'DELETE', url: `/api/workspaces/${tenantId}/members/${aId}`, headers: { cookie: oCookie } })
    expect(del.statusCode).toBe(200)
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: aCookie } })
    expect(acc.statusCode).toBe(409)
    const rows = await ctx.db.select().from(schema.membership)
      .where(and(eq(schema.membership.userId, aId), eq(schema.membership.tenantId, tenantId)))
    expect(rows).toHaveLength(0)
    await app.close()
  })

  it("une invitation dont l'auteur n'est plus membre (invitation restée en attente) est refusée", async () => {
    const app = await buildApp('multi')
    const { aId, tenantId, token } = await setup(app, 't19')
    // Retrait direct en base : l'invitation reste `pending`, seule la branche inviter_revoked peut refuser.
    await ctx.db.delete(schema.membership)
      .where(and(eq(schema.membership.userId, aId), eq(schema.membership.tenantId, tenantId)))
    const dCookie = await signUp(app, 't19-d@x.test', 'D')
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie: dCookie } })
    expect(acc.statusCode).toBe(409)
    expect(acc.json()).toEqual({ error: "Cette invitation n'est plus valable." })
    await app.close()
  })
})

describe('mode single : retrait de membre', () => {
  it('un membre retiré reçoit 403 sur POST /api/quizzes', async () => {
    const app = await buildApp('single')
    const ownerCookie = await signUp(app, 'single-owner@example.com', 'Owner')
    const memberCookie = await signUp(app, 'single-member@example.com', 'Member')
    // La base est partagée entre les tests du fichier : le premier inscrit en mode single est déjà
    // owner, donc on promeut explicitement celui-ci pour piloter les membres.
    const [ownerUser] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'single-owner@example.com'))
    await ctx.db.update(schema.membership).set({ role: 'owner' }).where(eq(schema.membership.userId, ownerUser.id))
    const tenantId = ((await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: ownerCookie } })).json() as WorkspacesResp).workspaces[0].tenantId
    const members = (await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/members`, headers: { cookie: ownerCookie } }))
      .json() as { members: Array<{ email: string; userId: string }> }
    const memberId = members.members.find((m) => m.email === 'single-member@example.com')!.userId
    const post = () => app.inject({
      method: 'POST', url: '/api/quizzes', payload: { title: 'Q' },
      headers: { 'content-type': 'application/json', cookie: memberCookie },
    })
    expect((await post()).statusCode).toBe(201)
    const remove = await app.inject({ method: 'DELETE', url: `/api/workspaces/${tenantId}/members/${memberId}`, headers: { cookie: ownerCookie } })
    expect(remove.statusCode).toBe(200)
    expect((await post()).statusCode).toBe(403)
    await app.close()
  })
})
