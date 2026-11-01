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
  readingTime: 0,
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
  readingTime: 0,
  basePoints: 500,
  payload: { correct: true },
}

const textQuestion: EngineQuestion = {
  id: 'q3',
  type: 'text',
  prompt: 'Capitale de la France ?',
  timeLimit: 10,
  readingTime: 0,
  basePoints: 500,
  payload: { answers: ['paris'], caseSensitive: false },
}

const sliderQuestion: EngineQuestion = {
  id: 'q4',
  type: 'slider',
  prompt: 'Devine le nombre',
  timeLimit: 10,
  readingTime: 0,
  basePoints: 500,
  payload: { min: 0, max: 100, correct: 42 },
}

const readingQuestion: EngineQuestion = {
  id: 'q5',
  type: 'mcq',
  prompt: 'Capitale du Japon ?',
  timeLimit: 10,
  readingTime: 6,
  basePoints: 1000,
  payload: {
    options: [
      { label: 'Osaka', correct: false },
      { label: 'Tokyo', correct: true },
    ],
  },
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

  describe('id/pin fournis (unification moteur↔DB, Task 2 persistance)', () => {
    it('createSession({ id, pin }) utilise EXACTEMENT l\'id et le PIN fournis (pas de genId/uniquePin)', async () => {
      const session = await engine.createSession({
        id: 'fixed-id',
        pin: '424242',
        quizId: 'q1',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      expect(session.id).toBe('fixed-id')
      expect(session.pin).toBe('424242')
    })

    it('createSession sans id/pin conserve le comportement existant (genId/uniquePin)', async () => {
      const session = await engine.createSession({
        quizId: 'q1',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      expect(session.id).toBe('id-1') // genId('id') — premier appel
      expect(session.pin).toBe('123456') // genPin injecté dans beforeEach
    })

    it('generateUniquePin() renvoie un PIN valide non déjà pris par une session existante', async () => {
      const sharedStore = new MemorySessionStore()
      const takenPin = 'takenPin' // volontairement invalide/non numérique : juste une valeur témoin
      const e = createEngine({
        store: sharedStore,
        now: clock.now,
        genPin: makePinGen(['111111', '222222']),
        genId: makeIdGen('a'),
      })
      await e.createSession({ id: 'sess-1', pin: takenPin, quizId: 'q1', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })

      // genPin() renvoie d'abord '111111' (libre, pas de collision avec takenPin) : accepté direct.
      const pin = await e.generateUniquePin()
      expect(pin).toBe('111111')
      expect(pin).not.toBe(takenPin)
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

  describe("phase 'reading' — temps de lecture (readingTime)", () => {
    it("startQuestion entre en 'reading' quand readingTime>0, sinon 'question'", async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion, readingQuestion],
      })

      // question 0 : readingTime 0 → 'question' (questionStartedAt posé, readingStartedAt null)
      let s = await engine.startQuestion(session.id)
      expect(s.phase).toBe('question')
      expect(s.questionStartedAt).toBe(0)
      expect(s.readingStartedAt).toBeNull()

      s = await engine.reveal(session.id)
      s = await engine.scoreboard(session.id)

      // question 1 : readingTime 6 → 'reading' (readingStartedAt posé, questionStartedAt null)
      clock.set(1000)
      s = await engine.nextQuestion(session.id)
      expect(s.phase).toBe('reading')
      expect(s.currentIndex).toBe(1)
      expect(s.readingStartedAt).toBe(1000)
      expect(s.questionStartedAt).toBeNull()
    })

    it("revealAnswers passe 'reading' → 'question' et pose questionStartedAt", async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [readingQuestion],
      })
      let s = await engine.startQuestion(session.id)
      expect(s.phase).toBe('reading')

      clock.set(6000)
      s = await engine.revealAnswers(session.id)
      expect(s.phase).toBe('question')
      expect(s.questionStartedAt).toBe(6000)
    })

    it('revealAnswers hors phase reading est un no-op sûr (idempotent)', async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [mcqQuestion],
      })
      const started = await engine.startQuestion(session.id) // readingTime 0 → 'question' directement
      expect(started.phase).toBe('question')

      const s = await engine.revealAnswers(session.id)
      expect(s.phase).toBe('question')
      expect(s.questionStartedAt).toBe(started.questionStartedAt)
    })

    it("submitAnswer est rejeté en phase 'reading'", async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [readingQuestion],
      })
      const { player } = await engine.addPlayer(session.id, 'Alice')
      const s = await engine.startQuestion(session.id)
      expect(s.phase).toBe('reading')

      const res = await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
      expect(res.accepted).toBe(false)
    })

    it('readingView ne contient pas les options', async () => {
      const session = await engine.createSession({
        quizId: 'q',
        tenantId: 't',
        hostId: 'h',
        questions: [readingQuestion],
      })
      const s = await engine.startQuestion(session.id)
      const view = engine.readingView(s) as Record<string, unknown>
      expect(view).not.toHaveProperty('options')
      expect(view).not.toHaveProperty('payload')
      expect(view.prompt).toBeDefined()
      expect(view).toEqual({ prompt: 'Capitale du Japon ?', index: 0, total: 1, readingTime: 6 })
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

describe('game engine : chemin de réponse sans copie de la session', () => {
  function makeSpyStore() {
    const inner = new MemorySessionStore()
    const calls = { get: 0, save: 0, peek: 0, recordAnswer: 0 }
    const spy = {
      get: (id: string) => {
        calls.get++
        return inner.get(id)
      },
      peek: (id: string) => {
        calls.peek++
        return inner.peek(id)
      },
      recordAnswer: (...args: Parameters<MemorySessionStore['recordAnswer']>) => {
        calls.recordAnswer++
        return inner.recordAnswer(...args)
      },
      getByPin: (pin: string) => inner.getByPin(pin),
      save: (s: Parameters<MemorySessionStore['save']>[0]) => {
        calls.save++
        return inner.save(s)
      },
      delete: (id: string) => inner.delete(id),
      evict: (id: string) => inner.evict(id),
    }
    return { spy, calls }
  }

  async function setup() {
    const clock = makeClock(0)
    const { spy, calls } = makeSpyStore()
    const engine = createEngine({ store: spy, now: clock.now, genPin: makePinGen(['123456']), genId: makeIdGen('id') })
    const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion, tfQuestion] })
    const { player } = await engine.addPlayer(session.id, 'Alice')
    await engine.startQuestion(session.id)
    return { clock, engine, calls, session, player }
  }

  it("une réponse acceptée n'appelle ni get ni save et appelle recordAnswer une fois", async () => {
    const { engine, calls, session, player } = await setup()
    calls.get = calls.save = calls.peek = calls.recordAnswer = 0
    const res = await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
    expect(res.accepted).toBe(true)
    expect(calls.get).toBe(0)
    expect(calls.save).toBe(0)
    expect(calls.recordAnswer).toBe(1)
  })

  it("progress n'appelle pas get", async () => {
    const { engine, calls, session } = await setup()
    calls.get = calls.peek = 0
    await engine.progress(session.id)
    expect(calls.get).toBe(0)
    expect(calls.peek).toBe(1)
  })

  it('deux submitAnswer du même joueur lancés sans attendre : une seule acceptation', async () => {
    const { engine, session, player } = await setup()
    const [a, b] = await Promise.all([
      engine.submitAnswer(session.id, player.id, { optionIndex: 1 }),
      engine.submitAnswer(session.id, player.id, { optionIndex: 0 }),
    ])
    expect([a.accepted, b.accepted].filter(Boolean)).toHaveLength(1)
    const rejected = a.accepted ? b : a
    expect(rejected.reason).toBe('réponse déjà soumise pour cette question')
  })

  it('hors phase question : refus avec la même reason', async () => {
    const { engine, session, player } = await setup()
    await engine.reveal(session.id)
    const res = await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
    expect(res).toEqual({ accepted: false, reason: 'hors phase question' })
  })

  it('session introuvable : même erreur que getSession', async () => {
    const { engine } = await setup()
    await expect(engine.submitAnswer('nope', 'p', {})).rejects.toThrow('session introuvable : nope')
    await expect(engine.peekSession('nope')).rejects.toThrow('session introuvable : nope')
  })

  it('une réponse puis reveal crédite les points une seule fois', async () => {
    const { engine, clock, session, player } = await setup()
    clock.set(1000)
    await engine.submitAnswer(session.id, player.id, { optionIndex: 1 })
    const first = await engine.reveal(session.id)
    const score = first.players[player.id]!.score
    expect(score).toBeGreaterThan(0)
    const second = await engine.reveal(session.id)
    expect(second.players[player.id]!.score).toBe(score)
  })
})

const wordcloudQuestion: EngineQuestion = {
  id: 'wc1',
  type: 'wordcloud',
  prompt: 'Un mot sur le café',
  timeLimit: 30,
  readingTime: 0,
  basePoints: 0,
  payload: {},
}

describe('game engine : nuage de mots', () => {
  async function setupWc(questions: EngineQuestion[] = [wordcloudQuestion]) {
    const clock = makeClock(0)
    const store = new MemorySessionStore()
    const engine = createEngine({ store, now: clock.now, genPin: makePinGen(['123456']), genId: makeIdGen('id') })
    const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions })
    const { player: alice } = await engine.addPlayer(session.id, 'Alice')
    const { player: bob } = await engine.addPlayer(session.id, 'Bob')
    await engine.startQuestion(session.id)
    return { engine, clock, session, alice, bob }
  }

  it('accepte des envois successifs, renvoie la liste complète et garde le timeMs du premier', async () => {
    const { engine, clock, session, alice } = await setupWc()
    clock.set(2000)
    const r1 = await engine.submitAnswer(session.id, alice.id, { word: 'chat' })
    clock.set(5000)
    const r2 = await engine.submitAnswer(session.id, alice.id, { word: 'chien' })
    const r3 = await engine.submitAnswer(session.id, alice.id, { word: 'oiseau' })
    expect(r1).toEqual({ accepted: true, words: ['chat'] })
    expect(r2.words).toEqual(['chat', 'chien'])
    expect(r3.accepted).toBe(true)
    expect(r3.words).toHaveLength(3)
    const stored = (await engine.getSession(session.id)).answers[0]![alice.id]!
    expect(stored.timeMs).toBe(2000)
    expect(stored.correct).toBe(false)
    expect(stored.points).toBe(0)
    expect(stored.answer).toEqual({ words: ['chat', 'chien', 'oiseau'] })
  })

  it('refuse un doublon (clé identique)', async () => {
    const { engine, session, alice } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'cafe' })
    const res = await engine.submitAnswer(session.id, alice.id, { word: 'Café' })
    expect(res).toEqual({ accepted: false, reason: 'mot déjà envoyé' })
  })

  it('refuse le 21e mot', async () => {
    const { engine, session, alice } = await setupWc()
    for (let i = 0; i < 20; i++) {
      const r = await engine.submitAnswer(session.id, alice.id, { word: `mot${i}` })
      expect(r.accepted).toBe(true)
    }
    const res = await engine.submitAnswer(session.id, alice.id, { word: 'mot20' })
    expect(res).toEqual({ accepted: false, reason: 'limite de 20 mots atteinte' })
  })

  it('allConnectedAnswered reste false même quand tous ont envoyé un mot', async () => {
    const { engine, session, alice, bob } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'a' })
    await engine.submitAnswer(session.id, bob.id, { word: 'b' })
    expect(engine.allConnectedAnswered(await engine.getSession(session.id))).toBe(false)
  })

  it('wordcloudView après removeWord : le mot disparaît et totalWords diminue', async () => {
    const { engine, session, alice, bob } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'cafe' })
    await engine.submitAnswer(session.id, alice.id, { word: 'thé' })
    await engine.submitAnswer(session.id, bob.id, { word: 'Café' })
    const before = engine.wordcloudView(await engine.getSession(session.id))!
    expect(before.totalWords).toBe(3)
    expect(before.questionId).toBe('wc1')
    expect(before.truncated).toBe(false)
    const removed = await engine.removeWord(session.id, 'CAFÉ')
    expect(removed.questionId).toBe('wc1')
    expect(removed.removedKeys).toEqual(['cafe'])
    const after = engine.wordcloudView(await engine.getSession(session.id))!
    expect(after.words.map((w) => w.key)).toEqual(['the'])
    expect(after.totalWords).toBe(1)
  })

  it('removeWord ne crée pas de doublon de clé', async () => {
    const { engine, session } = await setupWc()
    await engine.removeWord(session.id, 'cafe')
    const r = await engine.removeWord(session.id, 'CAFÉ')
    expect(r.removedKeys).toEqual(['cafe'])
  })

  it('un mot retiré renvoyé par un autre joueur reste absent', async () => {
    const { engine, session, alice, bob } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'cafe' })
    await engine.removeWord(session.id, 'cafe')
    const res = await engine.submitAnswer(session.id, bob.id, { word: 'cafe' })
    expect(res.accepted).toBe(true)
    const view = engine.wordcloudView(await engine.getSession(session.id))!
    expect(view.words).toEqual([])
    expect(view.totalWords).toBe(0)
  })

  it('removeWord fonctionne en phase reveal et lève en lobby', async () => {
    const { engine, session, alice } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'cafe' })
    await engine.reveal(session.id)
    await expect(engine.removeWord(session.id, 'cafe')).resolves.toBeTruthy()

    const clock = makeClock(0)
    const lobbyEngine = createEngine({
      store: new MemorySessionStore(),
      now: clock.now,
      genPin: makePinGen(['654321']),
      genId: makeIdGen('l'),
    })
    const lobby = await lobbyEngine.createSession({
      quizId: 'q',
      tenantId: 't',
      hostId: 'h',
      questions: [wordcloudQuestion],
    })
    await expect(lobbyEngine.removeWord(lobby.id, 'cafe')).rejects.toThrow(
      'retrait impossible hors question nuage de mots',
    )
  })

  it("removeWord lève si la question courante n'est pas un nuage", async () => {
    const { engine, session } = await setupWc([mcqQuestion])
    await expect(engine.removeWord(session.id, 'x')).rejects.toThrow('retrait impossible hors question nuage de mots')
  })

  it('wordcloudView vaut null pour une question non nuage', async () => {
    const { engine, session } = await setupWc([mcqQuestion])
    expect(engine.wordcloudView(await engine.getSession(session.id))).toBeNull()
  })

  it('questionResult vaut { correct: null, distribution: {} }', async () => {
    const { engine, session, alice } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'cafe' })
    expect(engine.questionResult(await engine.getSession(session.id))).toEqual({ correct: null, distribution: {} })
  })

  it("150 mots distincts : 100 mots, truncated, totaux sur l'ensemble", async () => {
    const { engine, session, alice, bob } = await setupWc()
    const players = [alice, bob]
    for (let i = 0; i < 6; i++) players.push((await engine.addPlayer(session.id, `P${i}`)).player)
    let n = 0
    for (const p of players) {
      for (let j = 0; j < 20 && n < 150; j++, n++) {
        await engine.submitAnswer(session.id, p.id, { word: `mot${n}` })
      }
    }
    const view = engine.wordcloudView(await engine.getSession(session.id))!
    expect(n).toBe(150)
    expect(view.words).toHaveLength(100)
    expect(view.truncated).toBe(true)
    expect(view.totalWords).toBe(150)
    expect(view.participants).toBe(8)
  })

  it('reveal ne change aucun score', async () => {
    const { engine, session, alice } = await setupWc()
    await engine.submitAnswer(session.id, alice.id, { word: 'cafe' })
    const s = await engine.reveal(session.id)
    expect(s.players[alice.id]!.score).toBe(0)
  })

  it('une question mcq refuse toujours une seconde réponse', async () => {
    const { engine, session, alice } = await setupWc([mcqQuestion])
    await engine.submitAnswer(session.id, alice.id, { optionIndex: 1 })
    const res = await engine.submitAnswer(session.id, alice.id, { optionIndex: 0 })
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('réponse déjà soumise pour cette question')
  })
})
