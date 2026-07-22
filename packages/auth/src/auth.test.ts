import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations } from '@splootlabs/db'
import { createAuth, type Auth } from './auth.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let auth: Auth

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  auth = createAuth(ctx.db, { secret: 'test-secret-at-least-32-chars-long!!', baseURL: 'http://localhost:3000' })
}, 120_000)

afterAll(async () => { await ctx?.stop() })

describe('Better Auth email/mot de passe', () => {
  it('inscrit puis connecte un hôte', async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email: 'hote@arena.fr', password: 'motdepasse-solide-123', name: 'Hôte Test' },
    })
    expect(signUp.user?.email).toBe('hote@arena.fr')

    const signIn = await auth.api.signInEmail({
      body: { email: 'hote@arena.fr', password: 'motdepasse-solide-123' },
    })
    expect(signIn.user?.email).toBe('hote@arena.fr')
    expect(signIn.token).toBeTruthy()
  })
})
