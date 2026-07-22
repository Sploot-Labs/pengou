import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('createDb', () => {
  it('se connecte à Postgres et exécute une requête', async () => {
    const rows = await ctx.db.execute(sql`select 1 as one`)
    expect(rows[0]).toMatchObject({ one: 1 })
  })
})
