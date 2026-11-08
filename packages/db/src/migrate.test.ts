import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
}, 120_000)
afterAll(async () => {
  await ctx?.stop()
})

describe('runMigrations', () => {
  it('applique les migrations sur une base vierge (table tenant présente)', async () => {
    await runMigrations(ctx.db)
    const rows = await ctx.db.execute(sql`select to_regclass('public.tenant') as t`)
    expect((rows[0] as { t: string | null }).t).toBe('tenant')
  })
})
