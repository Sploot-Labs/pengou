import { describe, it, expect } from 'vitest'
import { buildServer } from './app'
import { loadConfig } from '@splootlabs/shared'

describe('GET /health', () => {
  it('renvoie ok avec le mode runtime', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: 'ok',
      tenancyMode: 'single',
      scaling: 'memory',
    })
    await app.close()
  })

  it('renvoie ok + statut db', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up', tenancyMode: 'single', scaling: 'memory' })
    await app.close()
  })
})

describe('durcissement sécurité (helmet + rate-limit)', () => {
  it('helmet pose des en-têtes de sécurité (X-Content-Type-Options, X-Frame-Options, CSP)', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['content-security-policy']).toBeDefined()
    await app.close()
  })

  it('rate-limit renvoie 429 une fois le plafond dépassé', async () => {
    // Plafond bas via RATE_LIMIT_MAX pour prouver le 429 sans marteler.
    const app = await buildServer(loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX: '3' }))
    const codes: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' })
      codes.push(res.statusCode)
    }
    expect(codes.filter((c) => c === 200).length).toBe(3)
    expect(codes.filter((c) => c === 429).length).toBe(2)
    await app.close()
  })
})
