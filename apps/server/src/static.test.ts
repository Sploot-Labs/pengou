import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from './app'
import { registerStatic } from './static'
import { registerUploads } from './uploads'
import { loadConfig } from '@splootlabs/shared'

let dist: string

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'web-dist-'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>')
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe('service statique du SPA', () => {
  it('sert index.html à la racine', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    registerStatic(app, dist)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    await app.close()
  })

  it('fait un fallback SPA sur une route inconnue', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    registerStatic(app, dist)
    const res = await app.inject({ method: 'GET', url: '/quiz/123' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    await app.close()
  })

  it('ne fait pas de fallback SPA sur /health ou /api (404 JSON)', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    registerStatic(app, dist)

    const apiRes = await app.inject({ method: 'GET', url: '/api/unknown' })
    expect(apiRes.statusCode).toBe(404)
    expect(apiRes.json()).toMatchObject({ error: expect.any(String) })

    const healthRes = await app.inject({ method: 'GET', url: '/health/unknown' })
    expect(healthRes.statusCode).toBe(404)
    expect(healthRes.json()).toMatchObject({ error: expect.any(String) })

    await app.close()
  })

  it('ne fait pas de fallback SPA sous /uploads (404, pas index.html)', async () => {
    const media = mkdtempSync(join(tmpdir(), 'media-'))
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    registerUploads(app, media)
    registerStatic(app, dist)
    for (const url of ['/uploads/t1/absent.png', '/uploads/t1/', '/uploads']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(404)
      expect(res.body, url).not.toContain('id="root"')
    }
    await app.close()
    rmSync(media, { recursive: true, force: true })
  })
})
