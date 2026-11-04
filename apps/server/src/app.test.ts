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

describe('observabilité (readiness + metrics)', () => {
  it('/ready ping la DB : 200 si up, 503 si down', async () => {
    const up = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbPing: async () => true })
    const rUp = await up.inject({ method: 'GET', url: '/ready' })
    expect(rUp.statusCode).toBe(200)
    expect(rUp.json()).toMatchObject({ status: 'ready', db: 'up' })
    await up.close()

    const down = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbPing: async () => false })
    const rDown = await down.inject({ method: 'GET', url: '/ready' })
    expect(rDown.statusCode).toBe(503)
    await down.close()
  })

  it('/metrics expose des métriques Prometheus', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    const res = await app.inject({ method: 'GET', url: '/metrics' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('process_cpu_user_seconds_total')
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

  it("la CSP n'autorise aucun domaine de Google Fonts (polices auto-hébergées)", async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    const res = await app.inject({ method: 'GET', url: '/health' })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
    expect(csp).toContain("font-src 'self'")
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'(;|$)/)
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

describe("garde d'origine des requêtes mutantes", () => {
  const config = () => loadConfig({ NODE_ENV: 'test', BETTER_AUTH_URL: 'http://localhost:3000' })
  // Route factice : l'éditeur (base de données) n'est pas monté par buildServer seul.
  async function serveur() {
    const app = await buildServer(config())
    app.post('/api/invitations/:token/accept', async (_req, reply) => reply.code(401).send({ error: 'Non authentifié.' }))
    return app
  }

  it('POST /api/invitations/x/accept avec Origin étrangère renvoie 403', async () => {
    const app = await serveur()
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { origin: 'https://evil.example' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'Origine non autorisée.' })
    await app.close()
  })

  it('POST sans corps avec Sec-Fetch-Site: same-site renvoie 403', async () => {
    const app = await serveur()
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { 'sec-fetch-site': 'same-site' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('POST même origine passe la garde (401 sans cookie)', async () => {
    const app = await serveur()
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('BETTER_AUTH_URL avec barre finale : son origine reste acceptée', async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test', BETTER_AUTH_URL: 'http://localhost:3000/' }))
    app.post('/api/invitations/:token/accept', async (_req, reply) => reply.code(401).send({ error: 'Non authentifié.' }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { origin: 'http://localhost:3000', host: 'pengou.example' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("une Origin dont l'hôte est celui de l'en-tête Host passe la garde (démarrage rapide en LAN)", async () => {
    const app = await serveur()
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { origin: 'http://192.168.1.20:3000', host: '192.168.1.20:3000' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("un sous-domaine frère reste refusé, même avec le Host de l'app", async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test', BETTER_AUTH_URL: 'https://app.example.com' }))
    app.post('/api/invitations/:token/accept', async (_req, reply) => reply.code(401).send({ error: 'Non authentifié.' }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { origin: 'https://evil.example.com', host: 'app.example.com' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it.each(['none', 'same-origin'])('POST sans Origin avec Sec-Fetch-Site: %s passe la garde', async (site) => {
    const app = await serveur()
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/x/accept',
      headers: { 'sec-fetch-site': site },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("un GET avec Origin étrangère n'est pas bloqué par la garde", async () => {
    const app = await serveur()
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
