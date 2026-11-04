import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import {
  createMailer, DELIVERABILITY_MESSAGES, MemoryMailer, type DnsResolver, type Mailer, type OutgoingMail,
} from '@splootlabs/mail'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

const BASE_URL = 'http://localhost:3000'

function captureLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

type BuildOpts = {
  logger?: ReturnType<typeof captureLogger>
  invitationRateLimit?: boolean
  /** Force le contrôle DNS (sinon désactivé en test, faute de transport configuré). */
  domainCheck?: boolean
  resolver?: DnsResolver
}

async function buildApp(mailer: Mailer, opts: BuildOpts = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test', TENANCY_MODE: 'multi', ...(opts.domainCheck ? { EMAIL_DOMAIN_CHECK: 'true' } : {}),
  })
  // L'auth n'a pas de mailer : l'inscription n'envoie rien, seul l'envoi d'invitation est observé.
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!', baseURL: BASE_URL, tenancyMode: config.tenancyMode,
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, {
    systemDb: ctx.db, appDb: ctx.appDb, auth, config, mailer,
    mailLogger: opts.logger ?? captureLogger(),
    invitationRateLimit: opts.invitationRateLimit,
    resolver: opts.resolver,
  })
  return app
}

async function signUp(app: FastifyInstance, email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const raw = res.headers['set-cookie']
  return Array.isArray(raw) ? raw.map((c) => c.split(';')[0]).join('; ') : String(raw).split(';')[0]
}

/** Inscrit l'administrateur et lui crée un espace « Classe de CM2 » ; renvoie cookie et tenant. */
async function setupOwner(app: FastifyInstance, email: string, name = 'Camille Martin') {
  const cookie = await signUp(app, email, name)
  const created = await app.inject({
    method: 'POST', url: '/api/workspaces', payload: { name: 'Classe de CM2' },
    headers: { 'content-type': 'application/json', cookie },
  })
  expect(created.statusCode).toBe(201)
  const list = (await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })).json() as {
    workspaces: Array<{ tenantId: string; name: string }>
  }
  const tenantId = list.workspaces.find((w) => w.name === 'Classe de CM2')!.tenantId
  return { cookie, tenantId }
}

type InvitationResp = { invitation: { id: string; token: string }; emailSent: boolean }

function invite(app: FastifyInstance, tenantId: string, cookie: string, email: string) {
  return app.inject({
    method: 'POST', url: `/api/workspaces/${tenantId}/invitations`,
    payload: { email, role: 'member' },
    headers: { 'content-type': 'application/json', cookie },
  })
}

/** Preuve `v` portée par le lien de l'e-mail d'invitation. */
function proofFrom(mail: OutgoingMail): string {
  const v = /\/invitations\/[0-9a-f]+\?v=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1]
  expect(v).toBeTruthy()
  return v!
}

function accept(app: FastifyInstance, token: string, cookie: string, v?: string) {
  if (v === undefined) return app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { cookie } })
  return app.inject({
    method: 'POST', url: `/api/invitations/${token}/accept`, payload: { v },
    headers: { 'content-type': 'application/json', cookie },
  })
}

async function emailedAt(id: string): Promise<Date | null> {
  const [row] = await ctx.db.select({ emailedAt: schema.invitation.emailedAt }).from(schema.invitation)
    .where(eq(schema.invitation.id, id))
  return row.emailedAt
}

async function isVerified(email: string): Promise<boolean> {
  const [row] = await ctx.db.select({ v: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.email, email))
  return row.v
}

describe('e2e : invitation envoyée par e-mail', () => {
  it("création : e-mail parti avec le lien, l'invitant et l'espace ; emailed_at posé", async () => {
    const mailer = new MemoryMailer()
    const logger = captureLogger()
    const app = await buildApp(mailer, { logger })
    const { cookie, tenantId } = await setupOwner(app, 'inv-mail-owner@example.com')

    const res = await invite(app, tenantId, cookie, 'invite1@example.com')
    expect(res.statusCode).toBe(201)
    const body = res.json() as InvitationResp
    expect(body.emailSent).toBe(true)
    expect(mailer.sent).toHaveLength(1)
    const [mail] = mailer.sent
    expect(mail.kind).toBe('invitation')
    expect(mail.to).toBe('invite1@example.com')
    expect(mail.text).toContain(`${BASE_URL}/invitations/${body.invitation.token}?v=`)
    // La preuve n'est que dans l'e-mail : la réponse de l'API ne porte que le token nu.
    expect(res.body).not.toContain(proofFrom(mail))
    expect(mail.text).toContain('Camille Martin')
    expect(mail.text).toContain('Classe de CM2')
    expect(await emailedAt(body.invitation.id)).not.toBeNull()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'invitation', domain: 'example.com', ok: true }), expect.any(String),
    )
    await app.close()
  })

  it('renvoi : nouveau token dans le nouvel e-mail ; échec du renvoi remet emailed_at à nul', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const { cookie, tenantId } = await setupOwner(app, 'inv-mail-resend@example.com')
    const created = (await invite(app, tenantId, cookie, 'invite2@example.com')).json() as InvitationResp

    const resend = () => app.inject({
      method: 'POST', url: `/api/workspaces/${tenantId}/invitations/${created.invitation.id}/resend`, headers: { cookie },
    })
    const res = await resend()
    expect(res.statusCode).toBe(200)
    const body = res.json() as InvitationResp
    expect(body.emailSent).toBe(true)
    expect(body.invitation.token).not.toBe(created.invitation.token)
    expect(mailer.sent).toHaveLength(2)
    expect(mailer.sent[1].text).toContain(`${BASE_URL}/invitations/${body.invitation.token}`)
    expect(mailer.sent[1].text).not.toContain(created.invitation.token)
    expect(res.body).not.toContain(proofFrom(mailer.sent[1]))
    expect(await emailedAt(created.invitation.id)).not.toBeNull()

    mailer.failNext()
    const failed = await resend()
    expect(failed.statusCode).toBe(200)
    expect((failed.json() as InvitationResp).emailSent).toBe(false)
    expect(await emailedAt(created.invitation.id)).toBeNull()
    await app.close()
  })

  it("échec d'envoi : 201, emailSent faux, invitation listée, journal sans le token", async () => {
    const mailer = new MemoryMailer()
    const logger = captureLogger()
    const app = await buildApp(mailer, { logger })
    const { cookie, tenantId } = await setupOwner(app, 'inv-mail-fail@example.com')

    mailer.failNext()
    const res = await invite(app, tenantId, cookie, 'invite3@example.com')
    expect(res.statusCode).toBe(201)
    const body = res.json() as InvitationResp
    expect(body.emailSent).toBe(false)
    expect(body.invitation.token).toBeTruthy()
    expect(await emailedAt(body.invitation.id)).toBeNull()

    const list = (await app.inject({ method: 'GET', url: `/api/workspaces/${tenantId}/invitations`, headers: { cookie } })).json() as {
      invitations: Array<{ id: string }>
    }
    expect(list.invitations.map((i) => i.id)).toContain(body.invitation.id)

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'invitation', domain: 'example.com' }), expect.any(String),
    )
    const dump = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])
    expect(dump).not.toContain(body.invitation.token)
    expect(dump).not.toContain('invite3@example.com')
    await app.close()
  })

  it("mailer de repli : emailSent faux, rien n'est envoyé, emailed_at reste nul", async () => {
    const logger = captureLogger()
    const mailer = createMailer({ transport: 'none' }, logger)
    const send = vi.spyOn(mailer, 'send')
    const app = await buildApp(mailer, { logger })
    const { cookie, tenantId } = await setupOwner(app, 'inv-mail-none@example.com')

    const res = await invite(app, tenantId, cookie, 'invite4@example.com')
    expect(res.statusCode).toBe(201)
    const body = res.json() as InvitationResp
    expect(body.emailSent).toBe(false)
    expect(body.invitation.token).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
    expect(await emailedAt(body.invitation.id)).toBeNull()
    await app.close()
  })

  it('adresse jetable refusée en 400', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const { cookie, tenantId } = await setupOwner(app, 'inv-mail-jetable@example.com')

    const res = await invite(app, tenantId, cookie, 'x@yopmail.com')
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: DELIVERABILITY_MESSAGES.disposable })
    expect(mailer.sent).toHaveLength(0)
    await app.close()
  })

  it('domaine sans MX ni adresse refusé en 400 (contrôle DNS actif, résolveur injecté)', async () => {
    const notFound = async (): Promise<never> => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) }
    const resolver: DnsResolver = {
      resolveMx: async (d) => {
        if (d === 'domaine-mort.example') return notFound()
        return [{ exchange: `mx.${d}`, priority: 10 }]
      },
      resolve4: notFound,
      resolve6: notFound,
    }
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer, { domainCheck: true, resolver })
    const { cookie, tenantId } = await setupOwner(app, 'inv-mail-dns@example.com')

    const res = await invite(app, tenantId, cookie, 'personne@domaine-mort.example')
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: DELIVERABILITY_MESSAGES.undeliverable })
    expect((await invite(app, tenantId, cookie, 'quelquun@example.com')).statusCode).toBe(201)
    expect(mailer.sent).toHaveLength(1)
    await app.close()
  })
})

describe("e2e : l'acceptation d'une invitation e-mailée confirme l'adresse", () => {
  it('lien e-mailé, même adresse (casse et espaces près) : emailVerified devient vrai', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const { cookie, tenantId } = await setupOwner(app, 'inv-verif-owner@example.com')
    const { invitation } = (await invite(app, tenantId, cookie, 'camille@example.com')).json() as InvitationResp
    const v = proofFrom(mailer.sent[0])

    const guestCookie = await signUp(app, 'camille@example.com', 'Camille')
    // Adresse du compte écrite autrement que celle de l'invitation.
    await ctx.db.update(schema.user).set({ email: 'Camille@Example.com ' }).where(eq(schema.user.email, 'camille@example.com'))
    expect(await isVerified('Camille@Example.com ')).toBe(false)

    const acc = await accept(app, invitation.token, guestCookie, v)
    expect(acc.statusCode).toBe(200)
    expect(await isVerified('Camille@Example.com ')).toBe(true)
    await app.close()
  })

  it("lien copié sans preuve (l'auteur connaît le token) : emailVerified reste faux", async () => {
    const app = await buildApp(new MemoryMailer())
    const { cookie, tenantId } = await setupOwner(app, 'inv-verif-owner4@example.com')
    const { invitation } = (await invite(app, tenantId, cookie, 'copie@example.com')).json() as InvitationResp
    expect(await emailedAt(invitation.id)).not.toBeNull()

    const guestCookie = await signUp(app, 'copie@example.com', 'Copie')
    const acc = await accept(app, invitation.token, guestCookie)
    expect(acc.statusCode).toBe(200)
    expect(await isVerified('copie@example.com')).toBe(false)
    await app.close()
  })

  it('preuve fausse : acceptation réussie, emailVerified reste faux', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const { cookie, tenantId } = await setupOwner(app, 'inv-verif-owner5@example.com')
    const { invitation } = (await invite(app, tenantId, cookie, 'faux@example.com')).json() as InvitationResp
    const v = proofFrom(mailer.sent[0])
    const wrong = (v[0] === 'A' ? 'B' : 'A') + v.slice(1)

    const guestCookie = await signUp(app, 'faux@example.com', 'Faux')
    const acc = await accept(app, invitation.token, guestCookie, wrong)
    expect(acc.statusCode).toBe(200)
    expect(await isVerified('faux@example.com')).toBe(false)
    await app.close()
  })

  it('invitation jamais e-mailée : emailVerified reste faux', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const { cookie, tenantId } = await setupOwner(app, 'inv-verif-owner2@example.com')
    mailer.failNext()
    const { invitation, emailSent } = (await invite(app, tenantId, cookie, 'jamais@example.com')).json() as InvitationResp
    expect(emailSent).toBe(false)

    const guestCookie = await signUp(app, 'jamais@example.com', 'Jamais')
    const acc = await app.inject({ method: 'POST', url: `/api/invitations/${invitation.token}/accept`, headers: { cookie: guestCookie } })
    expect(acc.statusCode).toBe(200)
    expect(await isVerified('jamais@example.com')).toBe(false)
    await app.close()
  })

  it('lien e-mailé, autre adresse : emailVerified reste faux', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const { cookie, tenantId } = await setupOwner(app, 'inv-verif-owner3@example.com')
    const { invitation } = (await invite(app, tenantId, cookie, 'prevu@example.com')).json() as InvitationResp

    const otherCookie = await signUp(app, 'autre@example.com', 'Autre')
    const acc = await accept(app, invitation.token, otherCookie, proofFrom(mailer.sent[0]))
    expect(acc.statusCode).toBe(200)
    expect(await isVerified('autre@example.com')).toBe(false)
    await app.close()
  })
})

describe('e2e : limite de débit des invitations', () => {
  it('la 21e création ou renvoi dans l\'heure est refusée en 429', async () => {
    const app = await buildApp(new MemoryMailer(), { invitationRateLimit: true })
    const { cookie, tenantId } = await setupOwner(app, 'inv-limite@example.com')

    // 19 créations et 1 renvoi : la limite est commune aux deux routes.
    let first: InvitationResp | undefined
    for (let i = 0; i < 19; i++) {
      const res = await invite(app, tenantId, cookie, `limite${i}@example.com`)
      expect(res.statusCode).toBe(201)
      first ??= res.json() as InvitationResp
    }
    const resend = await app.inject({
      method: 'POST', url: `/api/workspaces/${tenantId}/invitations/${first!.invitation.id}/resend`, headers: { cookie },
    })
    expect(resend.statusCode).toBe(200)

    const over = await invite(app, tenantId, cookie, 'limite-de-trop@example.com')
    expect(over.statusCode).toBe(429)

    // La clé est l'utilisateur : un autre administrateur du même poste n'est pas bloqué.
    const other = await setupOwner(app, 'inv-limite-autre@example.com')
    expect((await invite(app, other.tenantId, other.cookie, 'ailleurs@example.com')).statusCode).toBe(201)
    await app.close()
  })
})
