import { describe, it, expect } from 'vitest'
import { buildServer } from './app'
import { loadConfig } from '@kahoot/shared'

describe('GET /health', () => {
  it('renvoie ok avec le mode runtime', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }))
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: 'ok',
      tenancyMode: 'single',
      scaling: 'memory',
    })
    await app.close()
  })
})
