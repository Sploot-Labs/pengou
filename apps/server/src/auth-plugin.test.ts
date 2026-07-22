import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { loadConfig } from '@splootlabs/shared'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('routes auth + garde de session', () => {
  it('monte /api/auth et protège une route (401 sans session)', async () => {
    const auth = createAuth(ctx.db, { secret: 'test-secret-at-least-32-chars-long!!', baseURL: 'http://localhost:3000' })
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
