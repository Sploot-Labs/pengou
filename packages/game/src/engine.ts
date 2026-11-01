import {
  questionTypes,
  aggregateWords,
  wordKey,
  WORDCLOUD_MAX_WORDS_PER_PLAYER,
  type WordcloudAnswer,
  type WordcloudAggregate,
} from '@splootlabs/quiz'
import type { GameSession, Player, EngineQuestion, SubmittedAnswer } from './state.js'
import type { SessionStore } from './store.js'

export type CreateSessionInput = {
  /** Id de session imposé (Task 2, unification moteur↔DB) — quand fourni (ex. depuis la
   * passerelle, qui l'a fait pointer vers une ligne `game_session` DÉJÀ créée), utilisé TEL
   * QUEL au lieu de `genId()`. Omis (tests moteur seuls, sans DB) : comportement inchangé. */
  id?: string
  /** PIN imposé (Task 2) — même logique que `id` : fourni quand déjà généré en amont via
   * `generateUniquePin()` (ex. par la passerelle, pour connaître le PIN AVANT de créer la ligne
   * DB). Omis : comportement inchangé (`uniquePin()` interne). */
  pin?: string
  quizId: string
  tenantId: string
  hostId: string
  questions: EngineQuestion[]
}

export type SubmitAnswerResult = { accepted: boolean; reason?: string; words?: string[] }

/** Nombre maximal de mots du nuage envoyés dans la projection (le reste est compté, pas listé). */
export const WORDCLOUD_VIEW_LIMIT = 100

export type WordcloudView = WordcloudAggregate & { questionId: string; truncated: boolean }

export type RankingEntry = { playerId: string; nickname: string; score: number }

/** Projection question envoyée aux joueurs — ne DOIT jamais contenir la bonne réponse.
 * `index`/`total` sont PUREMENT positionnels (numéro de question dans le quiz) : aucune
 * fuite de réponse, même rôle que sur `ReadingView`, pour afficher « n / N » côté joueur
 * aussi bien en phase lecture qu'en phase question. */
export type PlayerQuestionView = {
  id: string
  type: EngineQuestion['type']
  prompt: string
  timeLimit: number
  payload: unknown
  index: number
  total: number
} | null

/** Projection « temps de lecture » envoyée aux joueurs/écrans avant l'ouverture des réponses —
 * ne DOIT jamais contenir les options ni la bonne réponse (anti-triche). */
export type ReadingView = {
  prompt: string
  index: number
  total: number
  readingTime: number
}

export type QuestionResult = {
  correct: unknown
  distribution: Record<string, number>
}

/** Compteur de réponses pour la question courante (destiné au grand écran) — jamais de contenu
 * de réponse ici, uniquement des compteurs (anti-triche : rien à divulguer). */
export type ProgressInfo = { answered: number; total: number }

/** Résultat d'une reconnexion (Task 5) : `null` si aucun joueur ne correspond au joinToken
 * (session existante mais token inconnu/périmé) — distinct d'une session introuvable, qui reste
 * une erreur levée (cohérent avec le reste du moteur, voir `requireSession`). */
export type ReconnectResult = { session: GameSession; player: Player } | null

export type EngineDeps = {
  store: SessionStore
  /** Horloge injectée (jamais Date.now dans le moteur) — pour un timing déterministe/testable. */
  now: () => number
  /** Générateur de PIN injecté (jamais Math.random dans le moteur). */
  genPin: () => string
  /** Générateur d'identifiants injecté (jamais Math.random/uuid direct dans le moteur). */
  genId: () => string
}

export interface Engine {
  createSession(input: CreateSessionInput): Promise<GameSession>
  /** Génère un PIN garanti unique parmi les sessions actives, SANS créer de session (Task 2,
   * unification moteur↔DB) — délègue au même `uniquePin()` interne que `createSession`. Permet à
   * l'appelant (la passerelle) de connaître le PIN AVANT de créer la ligne DB, elle-même
   * nécessaire avant `createSession` (voir `store.save`/Task 3 : la ligne `game_session` doit
   * exister avant le premier `UPDATE … SET engine_state`). */
  generateUniquePin(): Promise<string>
  addPlayer(sessionId: string, nickname: string): Promise<{ session: GameSession; player: Player }>
  startQuestion(sessionId: string): Promise<GameSession>
  /** Fait sortir la session de la phase 'reading' (temps de lecture) vers 'question' et démarre
   * le chrono de réponse (`questionStartedAt = now()`). Garde : hors phase 'reading', no-op sûr
   * et idempotent (retourne la session inchangée) — cohérent avec les autres gardes du moteur. */
  revealAnswers(sessionId: string): Promise<GameSession>
  submitAnswer(sessionId: string, playerId: string, rawAnswer: unknown): Promise<SubmitAnswerResult>
  reveal(sessionId: string): Promise<GameSession>
  scoreboard(sessionId: string): Promise<GameSession>
  nextQuestion(sessionId: string): Promise<GameSession>
  podium(sessionId: string): Promise<GameSession>
  ranking(session: GameSession): RankingEntry[]
  /** Auto-révélation (lecture seule, synchrone) : vrai ssi la session est en phase 'question',
   * qu'il y a AU MOINS un joueur connecté, et que CHAQUE joueur connecté a soumis une réponse
   * pour la question courante. Un joueur déconnecté ne bloque jamais (ignoré). Zéro joueur
   * connecté ⟹ false (ne jamais auto-révéler une salle vide). */
  allConnectedAnswered(session: Readonly<GameSession>): boolean
  playerQuestionView(session: GameSession): PlayerQuestionView
  /** Projection « temps de lecture » — énoncé SEUL (jamais les options/réponses possibles :
   * anti-triche, cohérent avec `playerQuestionView`). */
  readingView(session: GameSession): ReadingView
  questionResult(session: GameSession): QuestionResult
  /** Projection agrégée du nuage de mots de la question courante (mots retirés exclus, 100 mots
   * au plus). `null` si la question courante n'est pas un nuage de mots. */
  wordcloudView(session: Readonly<GameSession>): WordcloudView | null
  /** Retire un mot du nuage (par clé de fusion) pour la question courante. Phases question,
   * reveal et scoreboard uniquement. */
  removeWord(
    sessionId: string,
    word: string,
  ): Promise<{ session: GameSession; questionId: string; removedKeys: string[] }>
  /** Marque un joueur (dé)connecté — n'affecte ni son score ni ses réponses. */
  setPlayerConnected(sessionId: string, playerId: string, connected: boolean): Promise<GameSession>
  /** Retrouve un joueur par joinToken (Task 5 : reconnexion) et le remarque `connected`. `null`
   * si aucun joueur de la session ne porte ce token. */
  reconnect(sessionId: string, joinToken: string): Promise<ReconnectResult>
  /** Compteur de réponses pour la question courante — pour le grand écran (jamais de contenu
   * de réponse, uniquement `answered`/`total`). */
  progress(sessionId: string): Promise<ProgressInfo>
  /** Lecture seule de la session courante (aucune mutation, aucun effet de bord) — utilisé par
   * la passerelle pour des décisions de routage (ex. détecter si la manche courante a déjà été
   * révélée avant `host:next`, ou si `host:reveal` est invoqué hors phase question) sans
   * dupliquer l'état moteur côté passerelle. */
  getSession(sessionId: string): Promise<GameSession>
  /** Lecture seule SANS copie (objet en cache du store). Lecture seule superficielle : ni l'objet
   * ni ses sous-objets ne doivent être modifiés : réservée aux chemins
   * chauds (réponse de joueur). Lève la même erreur que `getSession` si la session est introuvable. */
  peekSession(sessionId: string): Promise<Readonly<GameSession>>
  /** Re-ancre à `now()` le chrono de la phase COURANTE, sans changer de phase ni avancer
   * `currentIndex` (Task 4, réhydratation au boot) : après un redémarrage serveur, le chrono
   * repart à zéro plutôt que d'hériter d'un `questionStartedAt`/`readingStartedAt` figé à
   * l'instant du crash — décision produit du plan de persistance ("chrono qui repart à neuf").
   * Seule façon propre de persister ce ré-ancrage : le moteur est le seul dépositaire du
   * `store` — la passerelle n'y a pas d'accès direct. No-op sûr (retourne la session inchangée,
   * SANS `store.save`) hors phases 'reading'/'question' : rien à ré-ancrer ailleurs. */
  reanchorTimer(sessionId: string): Promise<GameSession>
  /** Évince une session TERMINÉE du store (cache mémoire) — la passerelle n'a pas d'accès direct
   * au store (seul le moteur le porte). Selon l'implémentation du `SessionStore`, `delete` peut
   * aussi effacer l'`engine_state` en DB (c'est le cas du store persistant) : au podium cette
   * colonne est déjà à null, la 2ᵉ passe est donc idempotente/inoffensive. Sans cette éviction,
   * toute partie jouée resterait indéfiniment dans le cache du store → fuite mémoire. */
  evictSession(sessionId: string): Promise<void>
}

export function createEngine(deps: EngineDeps): Engine {
  const { store, now, genPin, genId } = deps

  async function requireSession(sessionId: string): Promise<GameSession> {
    const session = await store.get(sessionId)
    if (!session) throw new Error(`session introuvable : ${sessionId}`)
    return session
  }

  async function requirePeek(sessionId: string): Promise<Readonly<GameSession>> {
    const session = await store.peek(sessionId)
    if (!session) throw new Error(`session introuvable : ${sessionId}`)
    return session
  }

  // Borne le retry : un genPin dégénéré/épuisé (ex. espace de PIN saturé, générateur bugué) ne
  // doit jamais faire boucler createSession indéfiniment.
  const MAX_PIN_ATTEMPTS = 50

  /** PIN unique parmi les sessions actives : retente tant que genPin() collide, borné. */
  async function uniquePin(): Promise<string> {
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt++) {
      const pin = genPin()
      const collision = await store.getByPin(pin)
      if (!collision) return pin
    }
    throw new Error('impossible de générer un PIN unique')
  }

  function currentQuestion(session: Readonly<GameSession>): EngineQuestion | undefined {
    return session.questions[session.currentIndex]
  }

  const engine: Engine = {
    async generateUniquePin() {
      return uniquePin()
    },

    async createSession({ id, pin: inputPin, quizId, tenantId, hostId, questions }) {
      const pin = inputPin ?? (await uniquePin())
      const session: GameSession = {
        id: id ?? genId(),
        pin,
        quizId,
        tenantId,
        hostId,
        phase: 'lobby',
        questions,
        currentIndex: -1,
        questionStartedAt: null,
        readingStartedAt: null,
        players: {},
        answers: {},
        credited: {},
      }
      await store.save(session)
      return session
    },

    async addPlayer(sessionId, nickname) {
      const session = await requireSession(sessionId)
      const player: Player = {
        id: genId(),
        nickname,
        joinToken: genId(),
        score: 0,
        connected: true,
      }
      session.players[player.id] = player
      await store.save(session)
      return { session, player }
    },

    async startQuestion(sessionId) {
      const session = await requireSession(sessionId)
      const nextIndex = session.currentIndex + 1
      if (nextIndex >= session.questions.length) {
        throw new Error('startQuestion : plus de questions disponibles')
      }
      session.currentIndex = nextIndex
      const q = session.questions[nextIndex]
      if (q && q.readingTime > 0) {
        session.phase = 'reading'
        session.readingStartedAt = now()
        session.questionStartedAt = null
      } else {
        session.phase = 'question'
        session.questionStartedAt = now()
        session.readingStartedAt = null
      }
      await store.save(session)
      return session
    },

    async revealAnswers(sessionId) {
      const session = await requireSession(sessionId)
      if (session.phase !== 'reading') return session
      session.phase = 'question'
      session.questionStartedAt = now()
      await store.save(session)
      return session
    },

    async submitAnswer(sessionId, playerId, rawAnswer) {
      const session = await requirePeek(sessionId)

      if (session.phase !== 'question') {
        return { accepted: false, reason: 'hors phase question' }
      }
      if (!session.players[playerId]) {
        return { accepted: false, reason: 'joueur inconnu' }
      }
      const question = currentQuestion(session)
      if (!question) {
        return { accepted: false, reason: 'aucune question active' }
      }
      const isWordcloud = question.type === 'wordcloud'
      const alreadyAnswered = session.answers[session.currentIndex]?.[playerId]
      if (alreadyAnswered && !isWordcloud) {
        return { accepted: false, reason: 'réponse déjà soumise pour cette question' }
      }
      // Invariant normalement garanti par startQuestion (phase 'question' ⟹ questionStartedAt
      // posé) ; si jamais corrompu, on échoue FERMÉ (rejet) plutôt que d'ouvrir un fallback
      // `now()` qui accorderait silencieusement timeMs=0 (score plein) à une question mal démarrée.
      if (session.questionStartedAt === null) {
        return { accepted: false, reason: "question non démarrée correctement (questionStartedAt manquant)" }
      }

      const def = questionTypes[question.type]
      let answer: unknown
      try {
        answer = def.validateAnswer(rawAnswer)
      } catch {
        return { accepted: false, reason: 'réponse invalide pour ce type de question' }
      }

      // Horodatage 100% serveur : jamais de confiance dans un timing fourni par le client.
      const maxMs = question.timeLimit * 1000
      const rawTimeMs = now() - session.questionStartedAt
      const timeMs = Math.max(0, Math.min(rawTimeMs, maxMs))

      if (isWordcloud) {
        const { word } = answer as { word: string }
        const previous = alreadyAnswered ? (alreadyAnswered.answer as WordcloudAnswer).words : []
        const key = wordKey(word)
        if (previous.some((w) => wordKey(w) === key)) {
          return { accepted: false, reason: 'mot déjà envoyé' }
        }
        if (previous.length >= WORDCLOUD_MAX_WORDS_PER_PLAYER) {
          return { accepted: false, reason: `limite de ${WORDCLOUD_MAX_WORDS_PER_PLAYER} mots atteinte` }
        }
        const words = [...previous, word]
        // Le premier envoi fixe timeMs. Aucun await entre peek et recordAnswer (atomicité).
        const accumulated: SubmittedAnswer = {
          answer: { words } satisfies WordcloudAnswer,
          timeMs: alreadyAnswered ? alreadyAnswered.timeMs : timeMs,
          correct: false,
          points: 0,
        }
        await store.recordAnswer(sessionId, session.currentIndex, playerId, accumulated)
        return { accepted: true, words }
      }

      const correct = def.isCorrect(question.payload, answer)
      const points = def.score(question.payload, answer, { timeMs, maxMs, basePoints: question.basePoints })

      const submitted: SubmittedAnswer = { answer, timeMs, correct, points }

      // Aucun await entre la lecture par peek et l'insertion : la vérification « déjà répondu » et
      // l'enregistrement restent atomiques sur la boucle d'événements.
      await store.recordAnswer(sessionId, session.currentIndex, playerId, submitted)
      return { accepted: true }
    },

    async reveal(sessionId) {
      const session = await requireSession(sessionId)
      // Crédite les points de la question courante EXACTEMENT une fois, quelle que soit la phase
      // au moment de l'appel. Découplé de `phase` à dessein : si l'hôte enchaîne
      // scoreboard()/nextQuestion() avant reveal() (ou skip), la phase a déjà quitté 'question'
      // — un gate sur `phase === 'question'` ferait alors disparaître silencieusement les points
      // de la manche. `credited[currentIndex]` est la seule source de vérité pour l'idempotence :
      // un reveal() répété (même après un skip) ne recrédite jamais deux fois.
      if (!session.credited[session.currentIndex]) {
        const roundAnswers = session.answers[session.currentIndex] ?? {}
        for (const [playerId, submitted] of Object.entries(roundAnswers)) {
          const player = session.players[playerId]
          if (player) player.score += submitted.points
        }
        session.credited[session.currentIndex] = true
      }
      session.phase = 'reveal'
      await store.save(session)
      return session
    },

    async scoreboard(sessionId) {
      const session = await requireSession(sessionId)
      session.phase = 'scoreboard'
      await store.save(session)
      return session
    },

    async nextQuestion(sessionId) {
      const session = await requireSession(sessionId)
      if (session.currentIndex + 1 < session.questions.length) {
        return engine.startQuestion(sessionId)
      }
      return engine.podium(sessionId)
    },

    async podium(sessionId) {
      const session = await requireSession(sessionId)
      session.phase = 'podium'
      await store.save(session)
      return session
    },

    ranking(session) {
      return Object.values(session.players)
        .map((p) => ({ playerId: p.id, nickname: p.nickname, score: p.score }))
        .sort((a, b) => b.score - a.score)
    },

    allConnectedAnswered(session) {
      if (session.phase !== 'question') return false
      if (currentQuestion(session)?.type === 'wordcloud') return false
      const connectedPlayers = Object.values(session.players).filter((p) => p.connected)
      if (connectedPlayers.length < 1) return false
      const roundAnswers = session.answers[session.currentIndex] ?? {}
      return connectedPlayers.every((p) => roundAnswers[p.id] !== undefined)
    },

    playerQuestionView(session) {
      const question = currentQuestion(session)
      if (!question) return null
      const def = questionTypes[question.type]
      return {
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        timeLimit: question.timeLimit,
        payload: def.playerView(question.payload),
        index: session.currentIndex,
        total: session.questions.length,
      }
    },

    readingView(session) {
      const q = currentQuestion(session)
      return {
        prompt: q?.prompt ?? '',
        index: session.currentIndex,
        total: session.questions.length,
        readingTime: q?.readingTime ?? 0,
      }
    },

    // NOTE anti-triche (défense en profondeur) : cette méthode expose la bonne réponse en clair
    // (`correct: question.payload`). Le moteur ne la restreint pas lui-même à la phase `reveal`
    // (c'est une projection pure/synchrone, sans accès au store) — c'est à l'appelant (la
    // passerelle Socket.IO, Task 4) de NE l'émettre aux joueurs qu'après `reveal()`, jamais
    // pendant `question`.
    questionResult(session) {
      const question = currentQuestion(session)
      if (question?.type === 'wordcloud') return { correct: null, distribution: {} }
      const roundAnswers = session.answers[session.currentIndex] ?? {}
      const distribution: Record<string, number> = {}
      for (const submitted of Object.values(roundAnswers)) {
        const key = JSON.stringify(submitted.answer)
        distribution[key] = (distribution[key] ?? 0) + 1
      }
      return { correct: question?.payload, distribution }
    },

    wordcloudView(session) {
      const question = currentQuestion(session)
      if (!question || question.type !== 'wordcloud') return null
      const answers = Object.values(session.answers[session.currentIndex] ?? {}).map(
        (submitted) => submitted.answer as WordcloudAnswer,
      )
      const removed = new Set(session.wordcloudRemoved?.[question.id] ?? [])
      const aggregate = aggregateWords(answers, removed)
      return {
        questionId: question.id,
        words: aggregate.words.slice(0, WORDCLOUD_VIEW_LIMIT),
        participants: aggregate.participants,
        totalWords: aggregate.totalWords,
        truncated: aggregate.words.length > WORDCLOUD_VIEW_LIMIT,
      }
    },

    async removeWord(sessionId, word) {
      const session = await requireSession(sessionId)
      const question = currentQuestion(session)
      if (
        !question ||
        question.type !== 'wordcloud' ||
        (session.phase !== 'question' && session.phase !== 'reveal' && session.phase !== 'scoreboard')
      ) {
        throw new Error('retrait impossible hors question nuage de mots')
      }
      const removedMap = session.wordcloudRemoved ?? {}
      const removedKeys = removedMap[question.id] ?? []
      const key = wordKey(word)
      if (!removedKeys.includes(key)) removedKeys.push(key)
      removedMap[question.id] = removedKeys
      session.wordcloudRemoved = removedMap
      await store.save(session)
      return { session, questionId: question.id, removedKeys: [...removedKeys] }
    },

    async setPlayerConnected(sessionId, playerId, connected) {
      const session = await requireSession(sessionId)
      const player = session.players[playerId]
      if (player) {
        player.connected = connected
        await store.save(session)
      }
      return session
    },

    async reconnect(sessionId, joinToken) {
      const session = await requireSession(sessionId)
      const player = Object.values(session.players).find((p) => p.joinToken === joinToken)
      if (!player) return null
      player.connected = true
      await store.save(session)
      return { session, player }
    },

    async progress(sessionId) {
      const session = await requirePeek(sessionId)
      const total = Object.keys(session.players).length
      const answered = Object.keys(session.answers[session.currentIndex] ?? {}).length
      return { answered, total }
    },

    async getSession(sessionId) {
      return requireSession(sessionId)
    },

    async peekSession(sessionId) {
      return requirePeek(sessionId)
    },

    async reanchorTimer(sessionId) {
      const session = await requireSession(sessionId)
      if (session.phase === 'reading') {
        session.readingStartedAt = now()
      } else if (session.phase === 'question') {
        session.questionStartedAt = now()
      } else {
        return session
      }
      await store.save(session)
      return session
    },

    async evictSession(sessionId) {
      await store.delete(sessionId)
    },
  }

  return engine
}
