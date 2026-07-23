import { describe, it, expect } from 'vitest'
import { MemorySessionStore } from './store.js'
import type { GameSession } from './state.js'

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: 's1',
    pin: '123456',
    quizId: 'quiz-1',
    tenantId: 'tenant-1',
    hostId: 'host-1',
    phase: 'lobby',
    questions: [],
    currentIndex: -1,
    questionStartedAt: null,
    players: {},
    answers: {},
    credited: {},
    ...overrides,
  }
}

describe('MemorySessionStore', () => {
  it('save then get returns the session', async () => {
    const store = new MemorySessionStore()
    const session = makeSession()
    await store.save(session)
    const found = await store.get('s1')
    expect(found).toEqual(session)
  })

  it('get returns undefined for unknown id', async () => {
    const store = new MemorySessionStore()
    expect(await store.get('nope')).toBeUndefined()
  })

  it('getByPin finds an active (non-podium) session by pin', async () => {
    const store = new MemorySessionStore()
    const session = makeSession({ phase: 'lobby' })
    await store.save(session)
    const found = await store.getByPin('123456')
    expect(found?.id).toBe('s1')
  })

  it('getByPin returns undefined once the session has reached podium (ended)', async () => {
    const store = new MemorySessionStore()
    const session = makeSession({ phase: 'podium' })
    await store.save(session)
    expect(await store.getByPin('123456')).toBeUndefined()
    // but the session is still retrievable by id (for e.g. final reporting)
    expect(await store.get('s1')).toBeDefined()
  })

  it('getByPin returns undefined for unknown pin', async () => {
    const store = new MemorySessionStore()
    expect(await store.getByPin('000000')).toBeUndefined()
  })

  it('save re-indexes the pin if it changes across saves', async () => {
    const store = new MemorySessionStore()
    const session = makeSession({ pin: '111111' })
    await store.save(session)
    const updated = { ...session, pin: '222222' }
    await store.save(updated)
    expect(await store.getByPin('222222')).toBeDefined()
  })

  it('delete removes the session by id and frees its pin', async () => {
    const store = new MemorySessionStore()
    const session = makeSession()
    await store.save(session)
    await store.delete('s1')
    expect(await store.get('s1')).toBeUndefined()
    expect(await store.getByPin('123456')).toBeUndefined()
  })

  it('mutating the object passed to save() later does not corrupt stored state (defensive copy)', async () => {
    const store = new MemorySessionStore()
    const session = makeSession()
    await store.save(session)
    session.phase = 'podium' // mutate the caller's reference after saving
    const found = await store.get('s1')
    expect(found?.phase).toBe('lobby')
  })
})
