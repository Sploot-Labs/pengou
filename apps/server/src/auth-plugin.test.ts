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
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('inscrit un hôte puis autorise /api/me avec le cookie de session', async () => {
    const auth = createAuth(ctx.db, {
      secret: 'test-secret-at-least-32-chars-long!!',
      baseURL: 'http://localhost:3000',
    })
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    await registerAuth(app, auth)

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'hote@example.com', password: 'password123456', name: 'Hôte Test' },
      headers: { 'content-type': 'application/json' },
    })
    expect(signUp.statusCode).toBe(200)

    const rawCookies = signUp.headers['set-cookie']
    expect(rawCookies).toBeDefined()
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0]

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieHeader } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ user: { email: 'hote@example.com' } })

    await app.close()
  })
})
