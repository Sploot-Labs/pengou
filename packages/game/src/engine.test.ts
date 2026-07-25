import { describe, it, expect, beforeEach } from 'vitest'
import { createEngine, type Engine } from './engine.js'
import { MemorySessionStore } from './store.js'
import type { EngineQuestion } from './state.js'

function makeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    set: (ms: number) => {
      t = ms
    },
  }
}

function makeIdGen(prefix: string) {
  let n = 0
  return () => `${prefix}-${++n}`
}

function makePinGen(pins: string[]) {
  let i = 0
  return () => pins[Math.min(i++, pins.length - 1)]!
}

const mcqQuestion: EngineQuestion = {
  id: 'q1',
  type: 'mcq',
  prompt: '2+2?',
  timeLimit: 10, // secondes
  basePoints: 1000,
  payload: {
    options: [
      { label: '3', correct: false },
      { label: '4', correct: true },
    ],
  },
}

const tfQuestion: EngineQuestion = {
  id: 'q2',
  type: 'truefalse',
  prompt: 'La Terre est ronde',
  timeLimit: 10,
  basePoints: 500,
  payload: { correct: true },
}

const textQuestion: EngineQuestion = {
  id: 'q3',
  type: 'text',
  prompt: 'Capitale de la France ?',
  timeLimit: 10,
  basePoints: 500,
  payload: { answers: ['paris'], caseSensitive: false },
}

const sliderQuestion: EngineQuestion = {
  id: 'q4',
  type: 'slider',
  prompt: 'Devine le nombre',
  timeLimit: 10,
  basePoints: 500,
  payload: { min: 0, max: 100, correct: 42 },
}

describe('game engine — cycle déterministe complet', () => {
  let clock: ReturnType<typeof makeClock>
  let store: MemorySessionStore
  let engine: Engine

  beforeEach(() => {
    clock = makeClock(0)
    store = new MemorySessionStore()
    engine = createEngine({ store, now: clock.now, genPin: makePinGen(['123456']), genId: makeIdGen('id') })
  })

  it('lobby → question → reveal (bonus rapidité) → scoreboard (classement) → next → podium', async () => {
    const session = await engine.createSession({
      quizId: 'quiz-1',
      tenantId: 'tenant-1',
      hostId: 'host-1',
      questions: [mcqQuestion, tfQuestion],
    })
    expect(session.phase).toBe('lobby')
    expect(session.pin).toBe('123456')
    expect(session.currentIndex).toBe(-1)

    const { player: alice } = await engine.addPlayer(session.id, 'Alice')
    const { player: bob } = await engine.addPlayer(session.id, 'Bob')
    const { player: eve } = await engine.addPlayer(session.id, 'Eve')
    expect(alice.score).toBe(0)
    expect(alice.connected).toBe(true)
    expect(alice.id).not.toBe(alice.joinToken)

    let s = await engine.startQuestion(session.id)
    expect(s.phase).toBe('question')
    expect(s.currentIndex).toBe(0)
    expect(s.questionStartedAt).toBe(0)

    // Alice répond vite et juste (1s)
    clock.set(1000)
    const aliceResult = await engine.submitAnswer(session.id, alice.id, { optionIndex: 1 })
    expect(aliceResult.accepted).toBe(true)

    // Bob répond juste mais lentement (9s, proche de la limite de 10s)
    clock.set(9000)
    const bobResult = await engine.submitAnswer(session.id, bob.id, { optionIndex: 1 })
    expect(bobResult.accepted).toBe(true)

    // Eve répond faux
    clock.set(2000)
    const eveResult = await engine.submitAnswer(session.id, eve.id, { optionIndex: 0 })
    expect(eveResult.accepted).toBe(true) // soumission valide, réponse fausse

    s = await engine.reveal(session.id)
    expect(s.phase).toBe('reveal')
    expect(s.players[alice.id]!.score).toBeGreaterThan(s.players[bob.id]!.score)
    expect(s.players[bob.id]!.score).toBeGreaterThan(0)
    expect(s.players[eve.id]!.score).toBe(0)

    const result = engine.questionResult(s)
    expect(result.correct).toEqual(mcqQuestion.payload)
    expect(result.distribution[JSON.stringify({ optionIndex: 1 })]).toBe(2)
    expect(result.distribution[JSON.stringify({ optionIndex: 0 })]).toBe(1)

    s = await engine.scoreboard(session.id)
    expect(s.phase).toBe('scoreboard')
    const ranking = engine.ranking(s)
    expect(ranking.map((r) => r.playerId)).toEqual([alice.id, bob.id, eve.id])
    expect(ranking[0]).toEqual({ playerId: alice.id, nickname: 'Alice', score: s.players[alice.id]!.score })

    s = await engine.nextQuestion(session.id)
    expect(s.phase).toBe('question')
    expect(s.currentIndex).toBe(1)

    // Question 2 : personne ne répond, on avance directement
    s = await engine.reveal(session.id)
    s = await engine.scoreboard(session.id)
    s = await engine.nextQuestion(session.id)
    expect(s.phase).toBe('podium')

    const podiumRanking = engine.ranking(s)
    expect(podiumRanking[0]!.playerId).toBe(alice.id)

    const podiumSession = await engine.podium(session.id)
    expect(podiumSession.phase).toBe('podium')
  })

  it('rejette submitAnswer hors phase question', async () => {
    const session = await engine.createSession({
      quizId: 'q',
      tenantId: 't',
      hostId: 'h',
      questions: [mcqQuestion],
    })
    const { player } = await engine.addPlayer(session.id, 'Alice')
    // toujours en lobby, pas de startQuestion
    const res = await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
    expect(res.accepted).toBe(false)
    expect(res.reason).toBeTruthy()
  })

  it('rejette une double réponse du même joueur pour la même question', async () => {
    const session = await engine.createSession({
      quizId: 'q',
      tenantId: 't',
      hostId: 'h',
      questions: [mcqQuestion],
    })
    const { player } = await engine.addPlayer(session.id, 'Alice')
    await engine.startQuestion(session.id)

    const first = await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
    expect(first.accepted).toBe(true)

    const second = await engine.submitAnswer(session.id, player.id, { optionIndex: 0 })
    expect(second.accepted).toBe(false)
  })

  it('rejette une réponse dont le format ne valide pas contre le type de la question', async () => {
    const session = await engine.createSession({
      quizId: 'q',
      tenantId: 't',
      hostId: 'h',
      questions: [mcqQuestion],
    })
    const { player } = await engine.addPlayer(session.id, 'Alice')
    await engine.startQuestion(session.id)

    const res = await engine.submitAnswer(session.id, player.id, { garbage: true })
    expect(res.accepted).toBe(false)
  })

  it('clampe timeMs à timeLimit*1000 si le joueur répond après expiration', async () => {
    const session = await engine.createSession({
      quizId: 'q',
      tenantId: 't',
      hostId: 'h',
      questions: [mcqQuestion], // timeLimit: 10s
    })
    const { player } = await engine.addPlayer(session.id, 'Alice')
    await engine.startQuestion(session.id)

    clock.set(999_999) // très en retard
    await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
    const s = await engine.reveal(session.id)
    // même clampé au max, une réponse correcte doit rapporter au moins le score plancher (bonus rapidité à 50%)
    expect(s.players[player.id]!.score).toBeGreaterThan(0)
    expect(s.players[player.id]!.score).toBe(Math.round(1000 * 0.5))
  })

  describe('playerQuestionView — anti-triche : ne contient JAMAIS la bonne réponse', () => {
    it('mcq : pas de champ `correct` sur les options', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const s = await engine.startQuestion(session.id)
      const view = engine.playerQuestionView(s) as { payload: { options: Array<Record<string, unknown>> } }
      expect(view.payload.options).toEqual([{ label: '3' }, { label: '4' }])
      for (const opt of view.payload.options) expect(opt).not.toHaveProperty('correct')
    })

    it('truefalse : payload vide (pas de `correct`)', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [tfQuestion] })
      const s = await engine.startQuestion(session.id)
      const view = engine.playerQuestionView(s) as { payload: Record<string, unknown> }
      expect(view.payload).toEqual({})
      expect(view.payload).not.toHaveProperty('correct')
    })

    it('text : payload vide (pas de `answers`)', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [textQuestion] })
      const s = await engine.startQuestion(session.id)
      const view = engine.playerQuestionView(s) as { payload: Record<string, unknown> }
      expect(view.payload).toEqual({})
      expect(view.payload).not.toHaveProperty('answers')
    })

    it('slider : uniquement min/max (pas de `correct`)', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [sliderQuestion] })
      const s = await engine.startQuestion(session.id)
      const view = engine.playerQuestionView(s) as { payload: Record<string, unknown> }
      expect(view.payload).toEqual({ min: 0, max: 100 })
      expect(view.payload).not.toHaveProperty('correct')
    })

    it("expose id/type/prompt/timeLimit en plus du payload sans la réponse", async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const s = await engine.startQuestion(session.id)
      const view = engine.playerQuestionView(s) as Record<string, unknown>
      expect(view.id).toBe('q1')
      expect(view.type).toBe('mcq')
      expect(view.prompt).toBe('2+2?')
      expect(view.timeLimit).toBe(10)
    })
  })

  describe('PIN unique', () => {
    it('deux createSession successifs obtiennent des PIN différents', async () => {
      const sharedStore = new MemorySessionStore()
      const e1 = createEngine({ store: sharedStore, now: clock.now, genPin: makePinGen(['111111']), genId: makeIdGen('a') })
      const first = await e1.createSession({ quizId: 'q1', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      expect(first.pin).toBe('111111')

      const e2 = createEngine({ store: sharedStore, now: clock.now, genPin: makePinGen(['222222']), genId: makeIdGen('b') })
      const second = await e2.createSession({ quizId: 'q2', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      expect(second.pin).toBe('222222')
      expect(second.pin).not.toBe(first.pin)
    })

    it('genPin collision (retourne un PIN déjà pris) puis un PIN libre → le moteur retente', async () => {
      const sharedStore = new MemorySessionStore()
      const e1 = createEngine({ store: sharedStore, now: clock.now, genPin: makePinGen(['111111']), genId: makeIdGen('a') })
      await e1.createSession({ quizId: 'q1', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })

      let calls = 0
      const collidingThenFresh = () => {
        calls++
        return calls === 1 ? '111111' : '222222'
      }
      const e2 = createEngine({ store: sharedStore, now: clock.now, genPin: collidingThenFresh, genId: makeIdGen('b') })
      const second = await e2.createSession({ quizId: 'q2', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      expect(calls).toBe(2)
      expect(second.pin).toBe('222222')
    })

    it('un PIN redevient disponible une fois la session au podium (ended)', async () => {
      const sharedStore = new MemorySessionStore()
      const e1 = createEngine({ store: sharedStore, now: clock.now, genPin: makePinGen(['111111']), genId: makeIdGen('a') })
      const first = await e1.createSession({ quizId: 'q1', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      await e1.startQuestion(first.id)
      await e1.reveal(first.id)
      await e1.scoreboard(first.id)
      await e1.nextQuestion(first.id) // plus de questions → podium

      const e2 = createEngine({ store: sharedStore, now: clock.now, genPin: makePinGen(['111111']), genId: makeIdGen('b') })
      const second = await e2.createSession({ quizId: 'q2', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      expect(second.pin).toBe('111111') // réutilisé, aucune collision détectée
    })

    it('genPin qui collide TOUJOURS → createSession rejette après la borne (pas de boucle infinie)', async () => {
      const sharedStore = new MemorySessionStore()
      const e1 = createEngine({ store: sharedStore, now: clock.now, genPin: makePinGen(['111111']), genId: makeIdGen('a') })
      await e1.createSession({ quizId: 'q1', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })

      let calls = 0
      const alwaysColliding = () => {
        calls++
        return '111111' // toujours le même PIN déjà pris
      }
      const e2 = createEngine({ store: sharedStore, now: clock.now, genPin: alwaysColliding, genId: makeIdGen('b') })

      await expect(
        e2.createSession({ quizId: 'q2', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      ).rejects.toThrow(/PIN/)
      // borné : ne doit pas avoir retenté indéfiniment
      expect(calls).toBeLessThanOrEqual(50)
      expect(calls).toBeGreaterThan(1)
    })
  })

  describe('crédit des points — découplé de la phase, idempotent', () => {
    it('reveal() après scoreboard()/nextQuestion() (host a sauté reveal) crédite quand même les points', async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion, tfQuestion],
      })
      const { player } = await engine.addPlayer(session.id, 'Alice')

      await engine.startQuestion(session.id)
      clock.set(1000)
      const submit = await engine.submitAnswer(session.id, player.id, { optionIndex: 1 }) // correct
      expect(submit.accepted).toBe(true)

      // L'hôte enchaîne scoreboard() (ou nextQuestion()) AVANT reveal() : la phase quitte
      // 'question' avant que les points n'aient été crédités.
      let s = await engine.scoreboard(session.id)
      expect(s.phase).toBe('scoreboard')
      expect(s.players[player.id]!.score).toBe(0) // pas encore crédité

      // reveal() appelé après-coup doit tout de même créditer la manche (le crédit est indexé
      // par question, pas gaté par la phase courante).
      s = await engine.reveal(session.id)
      expect(s.players[player.id]!.score).toBeGreaterThan(0)
    })

    it('reveal() appelé deux fois ne crédite pas les points en double (idempotent)', async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      const { player } = await engine.addPlayer(session.id, 'Alice')

      await engine.startQuestion(session.id)
      clock.set(1000)
      await engine.submitAnswer(session.id, player.id, { optionIndex: 1 }) // correct

      const firstReveal = await engine.reveal(session.id)
      const scoreAfterFirst = firstReveal.players[player.id]!.score
      expect(scoreAfterFirst).toBeGreaterThan(0)

      const secondReveal = await engine.reveal(session.id)
      expect(secondReveal.players[player.id]!.score).toBe(scoreAfterFirst) // inchangé
    })
  })

  describe('reconnexion (join_token) — Task 5', () => {
    it('reconnect retrouve le joueur par joinToken, le remarque connected, et son score est conservé', async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      const { player } = await engine.addPlayer(session.id, 'Alice')
      await engine.startQuestion(session.id)
      clock.set(1000)
      await engine.submitAnswer(session.id, player.id, { optionIndex: 1 }) // correct
      const revealed = await engine.reveal(session.id)
      const scoreBeforeDisconnect = revealed.players[player.id]!.score
      expect(scoreBeforeDisconnect).toBeGreaterThan(0)

      // Le joueur se déconnecte (marqué non-connecté, mais reste dans la session avec son score).
      const disconnected = await engine.setPlayerConnected(session.id, player.id, false)
      expect(disconnected.players[player.id]!.connected).toBe(false)
      expect(disconnected.players[player.id]!.score).toBe(scoreBeforeDisconnect)

      // Reconnexion via joinToken : retrouve le MÊME joueur, remarqué connected, score intact.
      const result = await engine.reconnect(session.id, player.joinToken)
      expect(result).not.toBeNull()
      expect(result!.player.id).toBe(player.id)
      expect(result!.player.connected).toBe(true)
      expect(result!.player.score).toBe(scoreBeforeDisconnect)
      expect(result!.session.phase).toBe(revealed.phase)
    })

    it('reconnect avec un joinToken inconnu renvoie null (pas trouvé)', async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      await engine.addPlayer(session.id, 'Alice')

      const result = await engine.reconnect(session.id, 'jeton-inexistant')
      expect(result).toBeNull()
    })
  })

  describe('allConnectedAnswered — auto-révélation (tous les joueurs CONNECTÉS ont répondu)', () => {
    it("false en phase 'lobby'", async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      await engine.addPlayer(session.id, 'Alice')
      const s = await engine.getSession(session.id)
      expect(s.phase).toBe('lobby')
      expect(engine.allConnectedAnswered(s)).toBe(false)
    })

    it("false en phase 'reveal'", async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const { player } = await engine.addPlayer(session.id, 'Alice')
      await engine.startQuestion(session.id)
      await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
      const s = await engine.reveal(session.id)
      expect(s.phase).toBe('reveal')
      expect(engine.allConnectedAnswered(s)).toBe(false)
    })

    it("false quand un joueur CONNECTÉ n'a pas encore répondu", async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const { player: alice } = await engine.addPlayer(session.id, 'Alice')
      await engine.addPlayer(session.id, 'Bob')
      const s = await engine.startQuestion(session.id)
      await engine.submitAnswer(session.id, alice.id, { optionIndex: 1 })
      const current = await engine.getSession(session.id)
      expect(engine.allConnectedAnswered(current)).toBe(false)
    })

    it('true quand TOUS les joueurs connectés ont répondu', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const { player: alice } = await engine.addPlayer(session.id, 'Alice')
      const { player: bob } = await engine.addPlayer(session.id, 'Bob')
      await engine.startQuestion(session.id)
      await engine.submitAnswer(session.id, alice.id, { optionIndex: 1 })
      await engine.submitAnswer(session.id, bob.id, { optionIndex: 0 })
      const current = await engine.getSession(session.id)
      expect(engine.allConnectedAnswered(current)).toBe(true)
    })

    it('false quand il y a zéro joueur connecté (même en phase question)', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const { player } = await engine.addPlayer(session.id, 'Alice')
      await engine.startQuestion(session.id)
      await engine.setPlayerConnected(session.id, player.id, false)
      const current = await engine.getSession(session.id)
      expect(engine.allConnectedAnswered(current)).toBe(false)
    })

    it('true quand tous les CONNECTÉS ont répondu même si un joueur DÉCONNECTÉ, lui, n\'a pas répondu (ignoré)', async () => {
      const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
      const { player: alice } = await engine.addPlayer(session.id, 'Alice')
      const { player: bob } = await engine.addPlayer(session.id, 'Bob')
      await engine.startQuestion(session.id)
      await engine.submitAnswer(session.id, alice.id, { optionIndex: 1 })
      // Bob se déconnecte SANS avoir répondu : il ne doit plus bloquer l'auto-révélation.
      await engine.setPlayerConnected(session.id, bob.id, false)
      const current = await engine.getSession(session.id)
      expect(engine.allConnectedAnswered(current)).toBe(true)
    })
  })

  describe('progress — compteur de réponses (pour le grand écran)', () => {
    it("total = nombre de joueurs, answered = nombre de réponses soumises pour la question courante", async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      const { player: alice } = await engine.addPlayer(session.id, 'Alice')
      const { player: bob } = await engine.addPlayer(session.id, 'Bob')
      await engine.startQuestion(session.id)

      const before = await engine.progress(session.id)
      expect(before).toEqual({ answered: 0, total: 2 })

      await engine.submitAnswer(session.id, alice.id, { optionIndex: 1 })
      const afterOne = await engine.progress(session.id)
      expect(afterOne).toEqual({ answered: 1, total: 2 })

      await engine.submitAnswer(session.id, bob.id, { optionIndex: 0 })
      const afterBoth = await engine.progress(session.id)
      expect(afterBoth).toEqual({ answered: 2, total: 2 })
    })
  })
})
