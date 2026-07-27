import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  startTestDb, runMigrations, schema, tenantScope, createQuiz, createGameSession, setSessionStatus,
} from '@splootlabs/db'
import type { GameSession } from '@splootlabs/game'
import { PersistentSessionStore } from './persistent-store.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantId: string
let ownerId: string
let quizId: string

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const [tenant] = await ctx.db.insert(schema.tenant).values({ name: 'Persist' }).returning()
  const [owner] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'persist@x.fr', name: 'Persist', emailVerified: false })
    .returning()
  tenantId = tenant.id
  ownerId = owner.id
  const quiz = await createQuiz(tenantScope(ctx.db, tenantId), { ownerId, title: 'Quiz persistance' })
  quizId = quiz.id
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

function makeSession(id: string, pin: string): GameSession {
  return {
    id,
    pin,
    quizId,
    tenantId,
    hostId: ownerId,
    phase: 'question',
    questions: [
      {
        id: 'q1', type: 'mcq', prompt: 'Q1', timeLimit: 20, readingTime: 0, basePoints: 1000,
        payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] },
      },
    ],
    currentIndex: 0,
    questionStartedAt: 1000,
    readingStartedAt: null,
    players: {
      'player-1': { id: 'player-1', nickname: 'Alice', joinToken: 'tok-alice', score: 900, connected: true },
    },
    answers: {
      0: {
        'player-1': { answer: { choice: 0 }, timeMs: 3000, correct: true, points: 900 },
      },
    },
    credited: { 0: true },
  }
}

describe('PersistentSessionStore', () => {
  it('persiste et relit depuis la base après vidage du cache (simule un process neuf)', async () => {
    // Pré-créer la ligne game_session (FK d'engine_state) avec le MÊME id que le GameSession moteur.
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900101' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')

    const s = makeSession(dbSession!.id, dbSession!.pin)

    const store = new PersistentSessionStore(ctx.db)
    await store.save(s)

    // Nouvelle instance : cache vide, doit relire depuis Postgres.
    const fresh = new PersistentSessionStore(ctx.db)
    const got = await fresh.get(s.id)
    expect(got).toBeDefined()
    expect(got!.id).toBe(s.id)
    expect(got!.phase).toBe('question')
    // Clés numériques re-parsées (jsonb les sérialise en chaînes).
    expect(got!.answers[0]).toBeDefined()
    expect(got!.answers[0]['player-1'].points).toBe(900)
    expect(got!.credited[0]).toBe(true)

    expect(await fresh.getByPin(s.pin)).toMatchObject({ id: s.id })

    await fresh.delete(s.id)
    expect(await new PersistentSessionStore(ctx.db).get(s.id)).toBeUndefined()
  })

  it('get renvoie undefined pour un id inconnu (cache et base vides)', async () => {
    const store = new PersistentSessionStore(ctx.db)
    expect(await store.get(crypto.randomUUID())).toBeUndefined()
  })

  it('getByPin exclut une session terminée (phase podium + status ended), get la retrouve toujours par id', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900102' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = { ...makeSession(dbSession!.id, dbSession!.pin), phase: 'podium' as const }

    const store = new PersistentSessionStore(ctx.db)
    await store.save(s)
    // `status` est posé séparément (hors scope de cette classe) — en conditions réelles, la
    // clôture d'une partie pose phase=podium (save) ET status='ended' (setSessionStatus).
    await setSessionStatus(ctx.db, dbSession!.id, 'ended')

    // Exclusion côté cache (mêmes semantiques que MemorySessionStore).
    expect(await store.getByPin(s.pin)).toBeUndefined()
    expect(await store.get(s.id)).toBeDefined()

    // Exclusion côté base (status <> 'ended') pour un process neuf, cache vide.
    const fresh = new PersistentSessionStore(ctx.db)
    expect(await fresh.getByPin(s.pin)).toBeUndefined()
    expect(await fresh.get(s.id)).toBeDefined()
  })

  it('save puis get renvoie des clones (mutation ultérieure de la référence sans effet)', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900103' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)

    const store = new PersistentSessionStore(ctx.db)
    await store.save(s)
    s.phase = 'podium'

    const found = await store.get(s.id)
    expect(found?.phase).toBe('question')
  })
})
