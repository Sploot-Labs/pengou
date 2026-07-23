import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerRequireUser, requireUser } from './require-user.js'
import { loadConfig } from '@splootlabs/shared'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('requireUser', () => {
  it('protège une route : 401 sans session', async () => {
    const auth = createAuth(ctx.db, { secret: 'test-secret-at-least-32-chars-long!!', baseURL: 'http://localhost:3000' })
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    registerRequireUser(app, auth)
    app.get('/api/protected', { preHandler: requireUser }, async (req) => ({ id: req.user.id }))
    const res = await app.inject({ method: 'GET', url: '/api/protected' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
