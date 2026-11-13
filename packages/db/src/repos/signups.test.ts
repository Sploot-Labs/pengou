import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations, schema, startTestDb } from '../index.js'
import { countSignupsBySourceAndWeek } from './signups.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  // Semaine du lundi 2 novembre 2026, puis semaine du lundi 9 novembre 2026.
  const users: [string, string | null][] = [
    ['2026-11-03T10:00:00Z', 'accueil'],
    ['2026-11-08T22:00:00Z', 'accueil'],
    ['2026-11-04T10:00:00Z', null],
    ['2026-11-09T08:00:00Z', 'accueil'],
    ['2026-11-10T08:00:00Z', 'kahoot-gratuit'],
    ['2026-11-11T08:00:00Z', 'kahoot-gratuit'],
  ]
  await ctx.db.insert(schema.user).values(
    users.map(([at, source], i) => ({
      id: `u${i}`,
      name: `Hôte ${i}`,
      email: `hote${i}@example.org`,
      signupSource: source,
      createdAt: new Date(at),
    })),
  )
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('countSignupsBySourceAndWeek', () => {
  it('compte les inscriptions par semaine et par provenance, la plus récente en premier', async () => {
    expect(await countSignupsBySourceAndWeek(ctx.db)).toEqual([
      { week: '2026-11-09', source: 'kahoot-gratuit', signups: 2 },
      { week: '2026-11-09', source: 'accueil', signups: 1 },
      { week: '2026-11-02', source: 'accueil', signups: 2 },
      { week: '2026-11-02', source: null, signups: 1 },
    ])
  })
})
