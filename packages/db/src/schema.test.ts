import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'
import * as schema from './schema.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('schéma', () => {
  it("ajoute à user la version et la date d'acceptation des CGU, nullables (comptes existants à null)", async () => {
    const rows = await ctx.db.execute(sql`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_name = 'user' and column_name in ('terms_version', 'terms_accepted_at') order by column_name
    `)
    expect(rows).toEqual([
      { column_name: 'terms_accepted_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { column_name: 'terms_version', data_type: 'text', is_nullable: 'YES' },
    ])
    const [u] = await ctx.db.insert(schema.user)
      .values({ id: 'cgu-null', name: 'Ancien compte', email: 'ancien-cgu@example.com' }).returning()
    expect(u.termsVersion).toBeNull()
    expect(u.termsAcceptedAt).toBeNull()
  })

  it('crée les 11 tables attendues (dont user/session/account/verification de Better Auth)', async () => {
    const rows = await ctx.db.execute(sql`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name
    `)
    const names = rows.map((r) => (r as { table_name: string }).table_name)
    for (const t of ['account', 'answer_record', 'game_session', 'membership', 'question', 'quiz', 'session', 'session_player', 'tenant', 'user', 'verification']) {
      expect(names).toContain(t)
    }
  })

  it('applique l\'unicité du PIN uniquement aux sessions non terminées (ended/abandoned)', async () => {
    // Deux sessions "ended" ou "abandoned" avec le même PIN sont permises ; deux "lobby" avec le même PIN non.
    const info = await ctx.db.execute(sql`
      select indexdef from pg_indexes where indexname = 'game_session_active_pin_uidx'
    `)
    // Postgres inclut le cast d'enum dans indexdef (ex. 'ended'::session_status).
    expect((info[0] as { indexdef: string }).indexdef.toLowerCase()).toContain("where (status = any (array['lobby'::session_status, 'active'::session_status]))")
  })

  it('accepte le statut abandoned et défaut last_activity_at', async () => {
    const [t] = await ctx.db.insert(schema.tenant).values({ name: 'AbandonEnum' }).returning()
    const [u] = await ctx.db.insert(schema.user)
      .values({ id: crypto.randomUUID(), email: 'ab-enum@x.fr', name: 'AB', emailVerified: false }).returning()
    const [q] = await ctx.db.insert(schema.quiz).values({ tenantId: t.id, ownerId: u.id, title: 'Q' }).returning()
    const [s] = await ctx.db.insert(schema.gameSession)
      .values({ tenantId: t.id, quizId: q.id, hostId: u.id, pin: '909090', status: 'abandoned' }).returning()
    expect(s.status).toBe('abandoned')
    expect(s.lastActivityAt).toBeInstanceOf(Date)
  })
})
