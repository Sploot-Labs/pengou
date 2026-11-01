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

  it('P0-5 : une écriture « answers-only » est coalescée (DB pas encore à jour), flushAll la persiste', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900201' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)

    const store = new PersistentSessionStore(ctx.db)
    await store.save(s) // 1re écriture = CRITIQUE → flush immédiat

    // Ajout d'une réponse SEULEMENT (même phase/manche/crédit/joueurs) → coalescé, pas encore en DB.
    const s2 = structuredClone(s)
    s2.answers[0]['player-2'] = { answer: { choice: 1 }, timeMs: 4000, correct: false, points: 0 }
    s2.players['player-2'] = { id: 'player-2', nickname: 'Bob', joinToken: 'tok-bob', score: 0, connected: true }
    // NB : ajouter un joueur EST critique — on teste ici le cas answers-only pur :
    delete s2.players['player-2']
    await store.save(s2)

    // Un process neuf ne voit PAS encore la 2e réponse (écriture coalescée en attente).
    const beforeFlush = await new PersistentSessionStore(ctx.db).get(s.id)
    expect(beforeFlush!.answers[0]['player-2']).toBeUndefined()

    await store.flushAll()

    const afterFlush = await new PersistentSessionStore(ctx.db).get(s.id)
    expect(afterFlush!.answers[0]['player-2']).toBeDefined()
    expect(afterFlush!.answers[0]['player-2'].timeMs).toBe(4000)
  })

  it('P0-5 : un changement de phase (critique) est écrit immédiatement, sans flushAll', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900202' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)
    const store = new PersistentSessionStore(ctx.db)
    await store.save(s)

    const revealed = { ...structuredClone(s), phase: 'reveal' as const }
    await store.save(revealed) // phase change → CRITIQUE → durabilité immédiate

    const fresh = await new PersistentSessionStore(ctx.db).get(s.id)
    expect(fresh!.phase).toBe('reveal')
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

  it('evict retire la session du cache sans toucher la base et retourne le PIN', async () => {
    const store = new PersistentSessionStore(ctx.db)
    const s = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '767676' })
    const session = makeSession(s!.id, '767676')
    await store.save(session)

    const pin = store.evict(s!.id)
    expect(pin).toBe('767676')

    // Le cache est vide : getByPin ne doit PAS ressusciter la session (engine_state existe encore
    // en base ici, mais getByPin exclut les sessions non vivantes — la ligne est toujours 'lobby',
    // donc on vérifie plutôt via un second evict qui ne retrouve rien en cache).
    expect(store.evict(s!.id)).toBeUndefined()
  })

  it('peek renvoie le même objet, charge depuis la base sur un store neuf et reflète une save', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900301' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)
    await new PersistentSessionStore(ctx.db).save(s)

    const fresh = new PersistentSessionStore(ctx.db)
    const a = await fresh.peek(s.id)
    expect(a?.answers[0]['player-1'].points).toBe(900)
    expect(await fresh.peek(s.id)).toBe(a)
    await fresh.save({ ...s, phase: 'reveal' })
    expect((await fresh.peek(s.id))?.phase).toBe('reveal')
    expect(await fresh.peek(crypto.randomUUID())).toBeUndefined()
  })

  it('deux peek concurrents sur un store neuf renvoient le même objet', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900303' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)
    await new PersistentSessionStore(ctx.db).save(s)

    const fresh = new PersistentSessionStore(ctx.db)
    const [a, b] = await Promise.all([fresh.peek(s.id), fresh.peek(s.id)])
    expect(a).toBeDefined()
    expect(a).toBe(b)
  })

  it('un peek concurrent qui résout après un recordAnswer ne fait pas disparaître la réponse', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900304' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)
    await new PersistentSessionStore(ctx.db).save(s)

    const fresh = new PersistentSessionStore(ctx.db)
    const first = fresh.peek(s.id).then(async () => {
      await fresh.recordAnswer(s.id, 0, 'player-2', { answer: { choice: 1 }, timeMs: 4000, correct: false, points: 0 })
    })
    const second = fresh.peek(s.id)
    await Promise.all([first, second])
    expect((await fresh.get(s.id))!.answers[0]['player-2']?.timeMs).toBe(4000)
  })

  it('recordAnswer : visible tout de suite, écrit en base seulement après flushAll, copie de la réponse', async () => {
    const dbSession = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '900302' })
    await setSessionStatus(ctx.db, dbSession!.id, 'active')
    const s = makeSession(dbSession!.id, dbSession!.pin)
    const store = new PersistentSessionStore(ctx.db)
    await store.save(s)

    const submitted = { answer: { choice: 1 }, timeMs: 4000, correct: false, points: 0 }
    await store.recordAnswer(s.id, 0, 'player-2', submitted)
    submitted.timeMs = 1
    expect((await store.get(s.id))!.answers[0]['player-2'].timeMs).toBe(4000)
    expect((await store.peek(s.id))!.answers[0]['player-2'].timeMs).toBe(4000)

    expect((await new PersistentSessionStore(ctx.db).get(s.id))!.answers[0]['player-2']).toBeUndefined()
    await store.flushAll()
    expect((await new PersistentSessionStore(ctx.db).get(s.id))!.answers[0]['player-2'].timeMs).toBe(4000)
  })

  it('recordAnswer rejette pour une session absente du cache', async () => {
    const store = new PersistentSessionStore(ctx.db)
    await expect(
      store.recordAnswer(crypto.randomUUID(), 0, 'p', { answer: null, timeMs: 1, correct: false, points: 0 }),
    ).rejects.toThrow()
  })
})
