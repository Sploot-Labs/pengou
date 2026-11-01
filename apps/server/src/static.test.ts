import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from './app'
import { registerStatic } from './static'
import { loadConfig } from '@splootlabs/shared'

let dist: string

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'web-dist-'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>')
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("spa")')
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
})

describe('limite de débit HTTP et fichiers du SPA', () => {
  // Plafond bas (3) : une grande salle derrière une même IP publique (NAT d'établissement) charge
  // des centaines de fois index.html et les bundles ; ces requêtes ne doivent jamais consommer le
  // quota de l'API ni recevoir de 429.
  it('ne plafonne ni les fichiers statiques ni le fallback SPA', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX: '3' }))
    registerStatic(app, dist)
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      codes.push((await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })).statusCode)
      codes.push((await app.inject({ method: 'GET', url: '/index.html' })).statusCode)
      codes.push((await app.inject({ method: 'GET', url: '/' })).statusCode)
      codes.push((await app.inject({ method: 'GET', url: '/play/123456' })).statusCode)
    }
    expect(codes.every((c) => c === 200)).toBe(true)
    await app.close()
  })

  it('plafonne toujours les routes dynamiques, même après des chargements du SPA', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX: '3' }))
    app.get('/api/ping', async () => ({ ok: true }))
    registerStatic(app, dist)
    for (let i = 0; i < 5; i++) await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    const codes: number[] = []
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'GET', url: '/api/ping' })).statusCode)
    expect(codes.filter((c) => c === 200).length).toBe(3)
    expect(codes.filter((c) => c === 429).length).toBe(2)
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(429)
    await app.close()
  })
})
