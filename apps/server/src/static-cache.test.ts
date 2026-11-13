import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app'
import { registerStatic } from './static'

const BUNDLE = `console.log(${JSON.stringify('x'.repeat(4000))})`
let dist: string

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'web-dist-cache-'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>')
  writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), BUNDLE)
  writeFileSync(join(dist, 'assets', 'index-abc123.js.br'), brotliCompressSync(BUNDLE))
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
})

async function serve() {
  const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
  registerStatic(app, dist)
  return app
}

describe('cache HTTP du SPA', () => {
  it('garde un an, sans revalidation, les fichiers hashés de /assets/', async () => {
    const app = await serve()
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    await app.close()
  })

  it('fait revalider la page et les fichiers non hashés', async () => {
    const app = await serve()
    for (const url of ['/', '/join', '/favicon.svg']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(200)
      expect(res.headers['cache-control'], url).toBe('no-cache')
    }
    await app.close()
  })
})

describe('revalidation de la page', () => {
  it('donne un ETag à la page et répond 304 quand le navigateur la possède déjà', async () => {
    const app = await serve()
    const first = await app.inject({ method: 'GET', url: '/join' })
    const etag = String(first.headers.etag)
    expect(etag).toMatch(/^"[\w-]+"$/)
    // Même page sur toutes les routes de l'application : même ETag.
    expect((await app.inject({ method: 'GET', url: '/' })).headers.etag).toBe(etag)

    // Forme forte, forme faible (un reverse proxy qui compresse affaiblit l'ETag) et liste.
    for (const sent of [etag, `W/${etag}`, `"autre", W/${etag}`]) {
      const res = await app.inject({ method: 'GET', url: '/join', headers: { 'if-none-match': sent } })
      expect(res.statusCode, sent).toBe(304)
      expect(res.body, sent).toBe('')
      expect(res.headers.etag, sent).toBe(etag)
      expect(res.headers['cache-control'], sent).toBe('no-cache')
    }

    const stale = await app.inject({ method: 'GET', url: '/join', headers: { 'if-none-match': '"perime"' } })
    expect(stale.statusCode).toBe(200)
    expect(stale.body).toContain('id="root"')
    await app.close()
  })

  it('ne répond jamais 304 sur un chemin inconnu : le statut 404 prime', async () => {
    const app = await serve()
    const etag = String((await app.inject({ method: 'GET', url: '/' })).headers.etag)
    const res = await app.inject({ method: 'GET', url: '/zzz-unknown', headers: { 'if-none-match': etag } })
    expect(res.statusCode).toBe(404)
    expect(res.headers.etag).toBeUndefined()
    await app.close()
  })
})

describe('compression du SPA', () => {
  it("sert le fichier Brotli précompressé au client qui l'accepte", async () => {
    const app = await serve()
    const res = await app.inject({
      method: 'GET',
      url: '/assets/index-abc123.js',
      headers: { 'accept-encoding': 'br, gzip' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['content-type']).toMatch(/javascript/)
    expect(res.headers.vary).toMatch(/accept-encoding/i)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(BUNDLE)
    await app.close()
  })

  it('sert le fichier brut au client qui ne déclare aucune compression', async () => {
    const app = await serve()
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.body).toBe(BUNDLE)
    await app.close()
  })
})
