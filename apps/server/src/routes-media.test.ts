import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { MEDIA_MAX_BYTES } from './routes/media.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let app: FastifyInstance
let cookie: string
const tmp = mkdtempSync(join(tmpdir(), 'media-'))

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single', MEDIA_DIR: tmp })
  const auth = createAuth(ctx.db, {
    secret: 'test-secret-at-least-32-chars-long!!',
    baseURL: 'http://localhost:3000',
    tenancyMode: config.tenancyMode,
  })
  app = await buildServer(config, { dbStatus: () => 'up' })
  await registerAuth(app, auth)
  registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
  cookie = await signUp(app, 'media@example.com')
}, 120_000)

afterAll(async () => {
  await app?.close()
  await ctx?.stop()
  rmSync(tmp, { recursive: true, force: true })
})

/** Inscrit un utilisateur via Better Auth et renvoie le cookie de session à réutiliser. */
async function signUp(server: FastifyInstance, email: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'motdepasse-123456', name: 'Test User' },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.statusCode).toBe(200)
  const rawCookies = res.headers['set-cookie']
  expect(rawCookies).toBeDefined()
  return Array.isArray(rawCookies)
    ? rawCookies.map((c) => c.split(';')[0]).join('; ')
    : String(rawCookies).split(';')[0]
}

async function multipart(bytes: Uint8Array, filename: string, type = 'image/png') {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), filename)
  const req = new Request('http://local', { method: 'POST', body: form })
  return { payload: Buffer.from(await req.arrayBuffer()), contentType: req.headers.get('content-type')! }
}

/** Une « image » PNG : la signature PNG complétée de zéros jusqu'à `size` octets. */
function png(size = 64): Uint8Array {
  const buf = new Uint8Array(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return buf
}

/** Liste récursive des fichiers présents sous `tmp`. */
function filesOnDisk(): string[] {
  return readdirSync(tmp, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .sort()
}

async function upload(bytes: Uint8Array, filename: string, type?: string, withCookie = true) {
  const { payload, contentType } = await multipart(bytes, filename, type)
  return app.inject({
    method: 'POST',
    url: '/api/media',
    payload,
    headers: { 'content-type': contentType, ...(withCookie ? { cookie } : {}) },
  })
}

function storedPath(url: string): string {
  return join(tmp, url.replace('/uploads/', ''))
}

describe('POST /api/media', () => {
  it('201 : PNG valide écrit sous <tenantId>/<uuid>.png', async () => {
    const res = await upload(png(), 'photo.png')
    expect(res.statusCode).toBe(201)
    const { url } = res.json() as { url: string }
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/)
    expect(existsSync(storedPath(url))).toBe(true)
    // La route reste sous le rate limit global.
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
  })

  it('extension déduite des octets : un JPEG nommé photo.png est stocké en .jpg', async () => {
    const jpeg = new Uint8Array(32)
    jpeg.set([0xff, 0xd8, 0xff, 0xe0])
    const res = await upload(jpeg, 'photo.png', 'image/png')
    expect(res.statusCode).toBe(201)
    const { url } = res.json() as { url: string }
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/)
    expect(existsSync(storedPath(url))).toBe(true)
  })

  it('415 : SVG renommé photo.png avec Content-Type image/png, rien écrit sur disque', async () => {
    const before = filesOnDisk()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const res = await upload(svg, 'photo.png', 'image/png')
    expect(res.statusCode).toBe(415)
    expect(res.json()).toEqual({ error: 'Format non pris en charge (PNG, JPEG, WebP ou GIF).' })
    expect(filesOnDisk()).toEqual(before)
  })

  it('415 : fichier texte quelconque', async () => {
    const before = filesOnDisk()
    const res = await upload(Buffer.from('bonjour, je ne suis pas une image'), 'notes.txt', 'text/plain')
    expect(res.statusCode).toBe(415)
    expect(filesOnDisk()).toEqual(before)
  })

  it('201 : exactement MEDIA_MAX_BYTES octets', async () => {
    expect(MEDIA_MAX_BYTES).toBe(2_097_152)
    const res = await upload(png(MEDIA_MAX_BYTES), 'grande.png')
    expect(res.statusCode).toBe(201)
    const { url } = res.json() as { url: string }
    expect(existsSync(storedPath(url))).toBe(true)
  })

  it('413 : MEDIA_MAX_BYTES + 1 octets, rien écrit sur disque', async () => {
    const before = filesOnDisk()
    const res = await upload(png(MEDIA_MAX_BYTES + 1), 'trop-grande.png')
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: 'Image trop lourde (2 Mo max).' })
    expect(filesOnDisk()).toEqual(before)
  })

  it('400 : requête multipart sans champ fichier', async () => {
    const form = new FormData()
    form.append('legende', 'pas de fichier ici')
    const req = new Request('http://local', { method: 'POST', body: form })
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      payload: Buffer.from(await req.arrayBuffer()),
      headers: { 'content-type': req.headers.get('content-type')!, cookie },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Aucun fichier reçu.' })
  })

  it('400 : corps JSON au lieu de multipart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      payload: { file: 'iVBORw0KGgo=' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Aucun fichier reçu.' })
  })

  it('401 : sans cookie de session', async () => {
    const before = filesOnDisk()
    const res = await upload(png(), 'photo.png', 'image/png', false)
    expect(res.statusCode).toBe(401)
    expect(filesOnDisk()).toEqual(before)
  })

  it("les routes JSON restent inchangées après l'enregistrement du multipart", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      payload: { title: 'Quiz après multipart' },
      headers: { 'content-type': 'application/json', cookie },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('POST /api/media : quota du workspace (multi)', () => {
  it("refuse en 403 l'image qui dépasse le quota", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-quota-'))
    const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'multi', MEDIA_DIR: dir, MEDIA_QUOTA_MB: '1' })
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
      tenancyMode: config.tenancyMode,
    })
    const server = await buildServer(config, { dbStatus: () => 'up' })
    await registerAuth(server, auth)
    registerEditor(server, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })
    try {
      const owner = await signUp(server, 'media-quota@example.com')
      const workspaces = await server.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: owner } })
      const tenantId = (workspaces.json() as { workspaces: Array<{ tenantId: string }> }).workspaces[0].tenantId
      const body = await multipart(png(600 * 1024), 'a.png')
      const send = () =>
        server.inject({
          method: 'POST',
          url: '/api/media',
          headers: { cookie: owner, 'x-tenant-id': tenantId, 'content-type': body.contentType },
          payload: body.payload,
        })
      expect((await send()).statusCode).toBe(201)
      const refused = await send()
      expect(refused.statusCode).toBe(403)
      expect(refused.json()).toEqual({ error: 'Espace images du workspace plein (1 Mo max).' })
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
