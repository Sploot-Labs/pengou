import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { DELIVERABILITY_MESSAGES, MemoryMailer, type DnsResolver } from '@splootlabs/mail'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

const BASE_URL = 'http://localhost:3000'
const DEAD_DOMAIN = 'domaine-mort.example'

function dnsError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** Résolveur factice : tout domaine a un MX, sauf DEAD_DOMAIN qui n'a rien. */
const resolver: DnsResolver = {
  resolveMx: async (d) => {
    if (d === DEAD_DOMAIN) throw dnsError('ENOTFOUND')
    return [{ exchange: `mx.${d}`, priority: 10 }]
  },
  resolve4: async () => {
    throw dnsError('ENOTFOUND')
  },
  resolve6: async () => {
    throw dnsError('ENOTFOUND')
  },
}

async function buildApp(mailer: MemoryMailer) {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi' })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: BASE_URL,
    tenancyMode: config.tenancyMode,
    mailer,
    mailTransport: 'smtp',
    emailDomainCheck: true,
    resolver,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  const app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth, { mailEnabled: mailer.enabled })
  return app
}

function signUp(app: Awaited<ReturnType<typeof buildApp>>, email: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Camille', callbackURL: '/?email-verifie=1' },
    headers: { 'content-type': 'application/json' },
  })
}

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  return list.map((c: string) => c.split(';')[0]).join('; ')
}

describe("e2e : confirmation d'adresse", () => {
  it("l'inscription envoie le lien, qui confirme l'adresse et ramène sur l'app", async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const email = 'confirme@example.com'

    const res = await signUp(app, email)
    expect(res.statusCode).toBe(200)
    expect(mailer.sent).toHaveLength(1)
    const [mail] = mailer.sent
    expect(mail.kind).toBe('verify-email')
    expect(mail.to).toBe(email)

    const link = new RegExp(`${BASE_URL}/api/auth/verify-email\\?\\S+`).exec(mail.text)?.[0]
    expect(link).toBeTruthy()
    const verify = await app.inject({ method: 'GET', url: link!.slice(BASE_URL.length) })
    expect(verify.statusCode).toBe(302)
    expect(verify.headers.location).toBe('/?email-verifie=1')

    const cookie = cookiesOf(verify) || cookiesOf(res)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect((me.json() as { user: { emailVerified: boolean } }).user.emailVerified).toBe(true)

    await app.close()
  })

  it("une panne d'envoi ne fait pas échouer l'inscription", async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    mailer.failNext()
    const res = await signUp(app, 'panne@example.com')
    expect(res.statusCode).toBe(200)
    expect(mailer.sent).toHaveLength(0)
    await app.close()
  })

  it('refuse une adresse jetable', async () => {
    const mailer = new MemoryMailer()
    const app = await buildApp(mailer)
    const res = await signUp(app, 'x@yopmail.com')
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toBe(DELIVERABILITY_MESSAGES.disposable)
    expect((res.json() as { message: string }).message).toBe('Les adresses e-mail jetables ne sont pas acceptées.')
    expect(mailer.sent).toHaveLength(0)
    await app.close()
  })

  it('refuse un domaine sans MX ni A', async () => {
    const app = await buildApp(new MemoryMailer())
    const res = await signUp(app, `camille@${DEAD_DOMAIN}`)
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toBe(DELIVERABILITY_MESSAGES.undeliverable)
    await app.close()
  })
})
