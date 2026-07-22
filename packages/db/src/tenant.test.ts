import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'
import { ensureDefaultTenant, resolveTenantId } from './tenant.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('ensureDefaultTenant', () => {
  it('reste idempotent sous concurrence (course)', async () => {
    const results = await Promise.all([
      ensureDefaultTenant(ctx.db),
      ensureDefaultTenant(ctx.db),
      ensureDefaultTenant(ctx.db),
    ])
    expect(new Set(results).size).toBe(1) // un seul id, aucune erreur, pas de doublon
  })

  it('est idempotent : deux appels renvoient le même id', async () => {
    const a = await ensureDefaultTenant(ctx.db)
    const b = await ensureDefaultTenant(ctx.db)
    expect(a).toBe(b)
  })
})

describe('resolveTenantId', () => {
  it('mode single : renvoie le tenant par défaut', async () => {
    const def = await ensureDefaultTenant(ctx.db)
    const resolved = await resolveTenantId(ctx.db, { tenancyMode: 'single' })
    expect(resolved).toBe(def)
  })

  it('mode multi : exige un tenant explicite, sinon lève', async () => {
    await expect(resolveTenantId(ctx.db, { tenancyMode: 'multi' })).rejects.toThrow()
    const ok = await resolveTenantId(ctx.db, { tenancyMode: 'multi' }, 'some-uuid')
    expect(ok).toBe('some-uuid')
  })
})
