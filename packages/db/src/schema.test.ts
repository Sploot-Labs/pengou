import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('schéma', () => {
  it('crée les 9 tables attendues', async () => {
    const rows = await ctx.db.execute(sql`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name
    `)
    const names = rows.map((r) => (r as { table_name: string }).table_name)
    for (const t of ['answer_record', 'game_session', 'membership', 'oauth_account', 'question', 'quiz', 'session_player', 'tenant', 'user']) {
      expect(names).toContain(t)
    }
  })

  it('applique l\'unicité du PIN uniquement aux sessions non terminées', async () => {
    // Deux sessions "ended" avec le même PIN sont permises ; deux "lobby" avec le même PIN non.
    const info = await ctx.db.execute(sql`
      select indexdef from pg_indexes where indexname = 'game_session_active_pin_uidx'
    `)
    // Postgres inclut le cast d'enum dans indexdef (ex. 'ended'::session_status).
    expect((info[0] as { indexdef: string }).indexdef.toLowerCase()).toContain("where (status <> 'ended'::session_status)")
  })
})
