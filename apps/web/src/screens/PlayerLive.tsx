import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { normalizeText, sliderTolerance } from '@splootlabs/quiz'
import { useCue, useSound } from '../motion/index.js'
import { clearPlayerSession, loadPlayerSession, savePlayerSession } from '../realtime/playerSession'
import { hardReload } from '../realtime/hardReload'
import { isKickedError } from '../realtime/ackError'
import { useGameSocket } from '../realtime/useGameSocket'
import type { RankingEntry, ReadingView, SessionRelaunchedView } from '../realtime/contracts'
import { ClosingView } from './Podium'
import { PlayerPoll } from './PlayerPoll'
import { PlayerWordcloud, type WordcloudAck } from './PlayerWordcloud'
import { AnswerShape, AnswerTile, Logo, SoundToggle, TimerPill } from '../ui'

/**
 * Parcours joueur réel, câblé sur la passerelle Socket.IO du serveur de jeu
 * (voir `apps/server/src/game-gateway.ts` — le contrat verbatim est reproduit
 * ci-dessous en commentaires). Plus aucune donnée mockée : tout provient des
 * événements serveur, et la bonne réponse n'existe nulle part côté client
 * avant `question:reveal`.
 */

/* ------------------------------------------------------------------ */
/* Contrat serveur (types locaux — pas de mock)                        */
/* ------------------------------------------------------------------ */

type QuestionKind = 'mcq' | 'truefalse' | 'text' | 'slider' | 'wordcloud' | 'poll'

/** `question:show` — projection anti-triche : jamais de bonne réponse.
 * `index`/`total` sont positionnels (numéro de question), ajoutés à la
 * projection moteur (voir `packages/game/src/engine.ts`,
 * `playerQuestionView`) pour afficher « n / N » côté joueur ; optionnels côté
 * client pour tolérer un flux plus ancien (ex. tests) sans planter. */
interface QuestionShowPayload {
  id: string
  type: QuestionKind
  prompt: string
  timeLimit: number
  payload: unknown
  index?: number
  total?: number
  /** Posé par le serveur sur le `question:show` rejoué à la reconnexion d'un joueur qui a déjà répondu. */
  alreadyAnswered?: boolean
}

/** Projection « lecture seule » émise par `question:reading` (Task 3, moteur
 * `readingView`) — DÉLIBÉRÉMENT sans `id`/`type`/`payload`/options, même
 * forme que celle consommée par `BigScreen` (voir son commentaire) : le
 * joueur ne doit rien pouvoir afficher qui ressemble à une réponse pendant la
 * lecture (anti-triche, cohérent avec le moteur qui ne les envoie pas). */

interface McqShowPayload {
  options: { label: string }[]
}
interface PollShowPayload {
  options: { label: string }[]
  multiple: boolean
}
interface SliderShowPayload {
  min: number
  max: number
}

interface TimerPayload {
  timeLimit: number
  /** Horodatage serveur (ms epoch) du démarrage de la question — `null` si
   * aucune question courante. Le compte à rebours se recalcule à partir de
   * cette valeur, jamais d'un simple chrono local démarré à la réception. */
  startedAt: number | null
}

/** `question:reveal` — seul moment où la bonne réponse existe côté client,
 * et seulement le temps de calculer le rendu (jamais stockée avant). Forme
 * exacte selon le type (voir packages/quiz/src/{mcq,truefalse,text,slider}.ts). */
interface RevealPayload {
  correct: unknown
  distribution: Record<string, number>
}
interface McqCorrect {
  options: { label: string; correct: boolean }[]
}
interface TrueFalseCorrect {
  correct: boolean
}
interface TextCorrect {
  answers: string[]
  caseSensitive?: boolean
}
interface SliderCorrect {
  min: number
  max: number
  correct: number
  step?: number
}

interface ReconnectAck {
  playerId: string
  phase: 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'
  score: number
}

interface AnswerAck {
  accepted: boolean
  reason?: string
}

/* ------------------------------------------------------------------ */
/* Évaluation locale de la correction — UNIQUEMENT après reveal         */
/* ------------------------------------------------------------------ */

type ResultKind = 'correct' | 'partial' | 'incorrect' | 'timeout'

/** Forme décorative des tuiles mcq : le serveur n'envoie que des labels, la
 * forme (étoile/goutte/vague/flocon, cf. AnswerShape) est une reconstitution
 * purement visuelle côté client, jamais un signal de correction. Les
 * identifiants restent triangle/diamond/circle/square (emplacements), cycle
 * au-delà de 4 options (le schéma en autorise jusqu'à 6). */
type TileShape = 'triangle' | 'diamond' | 'circle' | 'square'
const MCQ_SHAPES: readonly TileShape[] = ['triangle', 'diamond', 'circle', 'square']

/** Variables CSS d'un aplat de réponse (couleur + encre + ombre portée) pour
 * une grande tuile de verdict, depuis les tokens `--ans-*` (une option, une
 * couleur partout). */
/**
 * Rang en toutes lettres abrégées, accordé à « place » (féminin) pour rester
 * neutre vis-à-vis du joueur : 1ʳᵉ, 2ᵉ, 3ᵉ… (« 1ᵉ » n'existe pas).
 */
function placeOrdinal(rank: number): string {
  return rank === 1 ? '1ʳᵉ' : `${rank}ᵉ`
}

function tileVars(shape: TileShape): CSSProperties {
  return {
    ['--tile-color' as string]: `var(--ans-${shape})`,
    ['--tile-ink' as string]: `var(--ans-${shape}-ink)`,
    ['--tile-shadow' as string]: `var(--ans-${shape}-sh)`,
  } as CSSProperties
}

/** Pengou qui se dandine sur le lobby (décoratif, aria-hidden) — l'oscillation
 * est portée par `.player-penguin` et coupée sous prefers-reduced-motion. */
function WaddlePenguin() {
  return (
    <svg className="player-penguin" width="150" height="176" viewBox="0 0 64 76" aria-hidden="true" focusable="false">
      <ellipse cx="32" cy="40" rx="20" ry="28" fill="#12305a" />
      <ellipse cx="32" cy="46" rx="13" ry="20" fill="#ffffff" />
      <ellipse cx="13" cy="44" rx="4" ry="12" fill="#12305a" transform="rotate(18 13 44)" />
      <ellipse cx="51" cy="44" rx="4" ry="12" fill="#12305a" transform="rotate(-18 51 44)" />
      <circle cx="26" cy="27" r="3" fill="#ffffff" />
      <circle cx="38" cy="27" r="3" fill="#ffffff" />
      <circle cx="26.6" cy="27.6" r="1.5" fill="#0b2545" />
      <circle cx="38.6" cy="27.6" r="1.5" fill="#0b2545" />
      <path d="M28 32 L36 32 L32 37 Z" fill="#ff7a3c" />
      <ellipse cx="25" cy="69" rx="6" ry="2.6" fill="#ff7a3c" />
      <ellipse cx="39" cy="69" rx="6" ry="2.6" fill="#ff7a3c" />
    </svg>
  )
}

function evaluateMcq(correct: McqCorrect, optionIndex: number | null): ResultKind {
  if (optionIndex === null) return 'timeout'
  return correct.options[optionIndex]?.correct ? 'correct' : 'incorrect'
}

function evaluateTrueFalse(correct: TrueFalseCorrect, value: boolean | null): ResultKind {
  if (value === null) return 'timeout'
  return value === correct.correct ? 'correct' : 'incorrect'
}

function evaluateText(correct: TextCorrect, text: string): ResultKind {
  if (text.trim().length === 0) return 'timeout'
  const caseSensitive = correct.caseSensitive ?? false
  const given = normalizeText(text, caseSensitive)
  return correct.answers.some((candidate) => normalizeText(candidate, caseSensitive) === given)
    ? 'correct'
    : 'incorrect'
}

function evaluateSlider(correct: SliderCorrect, value: number | null): { kind: ResultKind; diff: number | null } {
  if (value === null) return { kind: 'timeout', diff: null }
  const diff = Math.abs(value - correct.correct)
  const tolerance = sliderTolerance(correct.min, correct.max)
  if (diff === 0) return { kind: 'correct', diff: 0 }
  if (diff <= tolerance) return { kind: 'partial', diff }
  return { kind: 'incorrect', diff }
}

type PlayerPhase = 'waiting' | 'reading' | 'question' | 'answered' | 'result' | 'podium'
type Connection = 'online' | 'reconnecting' | 'reconnected'

export function PlayerLive() {
  const navigate = useNavigate()
  const { socket, emitAck, on } = useGameSocket()
  const cue = useCue()
  const sound = useSound()

  // Chargé une seule fois : c'est l'identité de joueur anonyme (voir
  // realtime/playerSession.ts). Si absente, `/join` est la seule route valide.
  const storedRef = useRef(loadPlayerSession())
  const stored = storedRef.current

  const [kicked, setKicked] = useState(false)
  const kickedHeadingRef = useRef<HTMLHeadingElement>(null)
  const [phase, setPhase] = useState<PlayerPhase>('waiting')
  const [connection, setConnection] = useState<Connection>('online')
  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)

  const [reading, setReading] = useState<ReadingView | null>(null)
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null)
  const [timer, setTimer] = useState<TimerPayload | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [lastAward, setLastAward] = useState<number | null>(null)
  const [lastRanking, setLastRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])
  const [hasScoredQuestions, setHasScoredQuestions] = useState(true)

  // Enchaînement automatique : horodatage serveur de la prochaine bascule (diffusé par
  // `auto:advance`), reflété en compte à rebours — jamais un minuteur local indépendant.
  const [autoNextAt, setAutoNextAt] = useState<number | null>(null)
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null)

  // Compteur « manchots sur la glace » (lobby), alimenté par `lobby:count`,
  // vraie donnée serveur ; `null` tant qu'aucun compteur n'est arrivé (on
  // n'invente pas de nombre).
  const [lobbyCount, setLobbyCount] = useState<number | null>(null)

  // Série de bonnes réponses consécutives — calculée côté client à partir des
  // verdicts successifs (donnée locale honnête ; remise à zéro à la première
  // erreur / au premier temps écoulé, et non récupérable après une
  // reconnexion, voir l'effet de résultat plus bas).
  const [streak, setStreak] = useState(0)

  // Réponse en cours de capture, remise à zéro à chaque nouvelle question.
  const [mcqOptionIndex, setMcqOptionIndex] = useState<number | null>(null)
  const [boolChoice, setBoolChoice] = useState<boolean | null>(null)
  const [textValue, setTextValue] = useState('')
  const [sliderValue, setSliderValue] = useState(0)
  const [sliderTouched, setSliderTouched] = useState(false)
  const [pollSelection, setPollSelection] = useState<number[]>([])

  // Vérité serveur sur LA réponse effectivement comptabilisée pour cette
  // manche — distincte des valeurs capturées ci-dessus, qui ne reflètent que
  // ce que le joueur a cliqué/tapé localement. `evaluation()`/`renderRecap()`
  // ne doivent JAMAIS présenter une valeur locale comme « la » réponse si le
  // serveur ne l'a pas acceptée (course reveal/réponse-déjà-soumise/hors
  // phase, etc.) — sans quoi on afficherait « Bonne réponse ! » pour un choix
  // qui n'a jamais compté.
  const [answerAccepted, setAnswerAccepted] = useState(false)
  const [answerRejection, setAnswerRejection] = useState<string | null>(null)

  const promptRef = useRef<HTMLHeadingElement>(null)
  const answeredRef = useRef<HTMLParagraphElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const podiumHeadingRef = useRef<HTMLHeadingElement>(null)

  function resetAnswer(q: QuestionShowPayload) {
    setMcqOptionIndex(null)
    setBoolChoice(null)
    setTextValue('')
    setSliderTouched(false)
    setPollSelection([])
    setSliderValue(q.type === 'slider' ? (q.payload as SliderShowPayload).min : 0)
  }

  function hasSubmission(): boolean {
    if (!question) return false
    switch (question.type) {
      case 'mcq':
        return mcqOptionIndex !== null
      case 'truefalse':
        return boolChoice !== null
      case 'text':
        return textValue.trim().length > 0
      case 'slider':
        return sliderTouched
      case 'wordcloud':
        return true
      case 'poll':
        return answerAccepted
    }
  }

  /** Nuage de mots : chaque idée est envoyée seule, la phase reste 'question'
   * (le moteur accepte plusieurs envois) ; le refus est rendu par le composant. */
  async function submitWord(word: string): Promise<WordcloudAck> {
    if (phase !== 'question') return { accepted: false, reason: 'hors phase question' }
    sound.unlock()
    cue('answer.submit')
    return emitAck<WordcloudAck>('player:answer', { answer: { word } })
  }

  /**
   * Politique de nouvelle tentative après un rejet, décidée sur la raison
   * EXACTE renvoyée par le moteur (`packages/game/src/engine.ts` —
   * `submitAnswer`) :
   *  - « réponse invalide pour ce type de question » : ce garde est le
   *    DERNIER de `submitAnswer` côté moteur (après phase/joueur/question/
   *    déjà-répondu) — la manche est donc encore active, rien n'empêche un
   *    nouvel essai. On réaffiche la question (déverrouillée).
   *  - toute autre raison (« hors phase question », « réponse déjà soumise
   *    pour cette question », « aucune question active », question mal
   *    démarrée, joueur non rattaché) : la manche est déjà terminée côté
   *    serveur ou l'état est incohérent — on reste verrouillé ; le prochain
   *    `question:reveal`/`scoreboard` (déjà en vol ou imminent) reprendra le
   *    fil normalement.
   */
  function handleRejectedAnswer(reason: string | undefined) {
    setAnswerRejection(reason ? `Réponse non prise en compte : ${reason}` : 'Réponse non prise en compte.')
    if (reason === 'réponse invalide pour ce type de question') {
      setPhase('question')
    }
  }

  async function submitAnswer(answer: unknown) {
    if (phase !== 'question') return
    sound.unlock()
    cue('answer.submit')
    // Verrouille l'UI immédiatement (perçu instantané) — la confirmation
    // serveur arrive en tâche de fond.
    setAnswerRejection(null)
    setPhase('answered')
    try {
      const ack = await emitAck<AnswerAck>('player:answer', { answer })
      if (ack.accepted) {
        setAnswerAccepted(true)
        return
      }
      // Rejet « normal » du moteur (accepted:false + reason, PAS de champ
      // `error`) : emitAck résout au lieu de rejeter — c'est à NOUS de
      // vérifier `accepted`, sans quoi ce rejet serait silencieusement
      // ignoré et l'écran continuerait de prétendre que la réponse a été
      // enregistrée (course réaliste : le joueur répond juste au moment où
      // l'hôte révèle → accepted:false côté serveur, mais l'UI locale
      // resterait bloquée sur « enregistrée » puis calculerait « Bonne
      // réponse ! » à partir d'un choix qui n'a jamais compté).
      handleRejectedAnswer(ack.reason)
    } catch (err) {
      // Échec technique (emitAck a rejeté : ack `{error}` ou timeout) —
      // distinct d'un rejet de règle de jeu, mais le joueur doit savoir que
      // rien n'a été comptabilisé. Rien ne prouve que la manche soit
      // terminée (c'est peut-être juste la socket qui a un accroc) : on
      // rouvre la question pour permettre un nouvel essai.
      setAnswerRejection(err instanceof Error ? `Réponse non envoyée (${err.message}).` : 'Réponse non envoyée.')
      setPhase('question')
    }
  }

  /* ---------------------------------------------------------------- */
  /* Connexion, reconnexion, abonnements — un seul effet, un seul montage */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!stored) return

    let cancelled = false
    let hasConnectedOnce = false

    async function resync(showReconnectedBanner: boolean) {
      try {
        const ack = await emitAck<ReconnectAck>('player:reconnect', {
          pin: stored!.pin,
          joinToken: stored!.joinToken,
        })
        if (cancelled) return
        scoreRef.current = ack.score
        setScore(ack.score)
        // Le serveur ne renvoie une projection `question:show`/`timer` que si
        // la phase est 'question' (voir game-gateway.ts) — pour toute autre
        // phase (lobby/reveal/scoreboard/podium), on retombe sur « en attente »
        // et les prochains événements diffusés (question:show suivant, ou
        // podium) reprendront le fil normalement.
        if (ack.phase !== 'question') setPhase('waiting')
        if (showReconnectedBanner) setConnection('reconnected')
      } catch (err) {
        // joinToken invalide/périmé (ou PIN inconnu) : impossible de
        // continuer sans identité de joueur valide.
        if (cancelled) return
        clearPlayerSession()
        if (isKickedError(err)) {
          setKicked(true)
          return
        }
        navigate('/join', { replace: true })
      }
    }

    // Si la socket est déjà connectée au moment où cet effet s'exécute (cas
    // courant : la connexion transport a eu le temps de s'établir avant que
    // React ne monte l'effet), on tente la resynchronisation tout de suite —
    // sans attendre un événement 'connect' qui ne se reproduira pas puisqu'il
    // a déjà eu lieu. Sinon, le listener 'connect' ci-dessous s'en charge dès
    // que le transport est prêt. Dans les deux cas, pas de bannière
    // « reconnecté » pour cette toute première tentative : ce n'est pas une
    // coupure, c'est l'arrivée normale sur l'écran.
    if (socket.connected) {
      hasConnectedOnce = true
      void resync(false)
    }

    const offConnect = on('connect', () => {
      const isRealReconnect = hasConnectedOnce
      hasConnectedOnce = true
      void resync(isRealReconnect)
    })
    const offDisconnect = on('disconnect', () => {
      setConnection('reconnecting')
    })

    // Relance depuis le podium : on adopte la nouvelle identité puis on recharge
    // /play ; le remontage rejoint le nouveau lobby via `player:reconnect`.
    const offRelaunch = on<SessionRelaunchedView>('session:relaunched', (v) => {
      if (v.role !== 'player') return
      savePlayerSession({ pin: v.pin, playerId: v.playerId, joinToken: v.joinToken, nickname: v.nickname })
      hardReload('/play')
    })

    // Exclusion par l'animateur : l'identité locale est oubliée et l'écran
    // d'exclusion prend le pas sur tout le reste.
    const offKicked = on('player:kicked', () => {
      clearPlayerSession()
      setKicked(true)
    })

    const offReading = on<ReadingView>('question:reading', (view) => {
      setReading(view)
      // Même reset qu'à `question:show` ci-dessous — la phase lecture précède
      // la phase question de la MÊME manche, mais on ne veut aucune donnée de
      // la manche PRÉCÉDENTE qui traîne pendant la lecture (résultat/score
      // affiché par erreur, tuiles de la question d'avant, etc.).
      setQuestion(null)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setLastAward(null)
      setAnswerAccepted(false)
      setAnswerRejection(null)
      setAutoNextAt(null)
      setPhase('reading')
    })

    const offShow = on<QuestionShowPayload>('question:show', (view) => {
      setQuestion(view)
      setReading(null)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setLastAward(null)
      setAnswerAccepted(false)
      setAnswerRejection(null)
      setAutoNextAt(null)
      resetAnswer(view)
      if (view.type === 'poll' && view.alreadyAnswered === true) {
        // Vote déjà compté avant le rechargement : on ne rouvre pas la saisie.
        setAnswerAccepted(true)
        setPhase('answered')
      } else {
        setPhase('question')
      }
    })

    const offTimer = on<TimerPayload>('timer', (t) => {
      setTimer(t)
    })

    const offReveal = on<RevealPayload>('question:reveal', (r) => {
      setRevealPayload(r)
      setPhase('result')
    })

    const offScoreboard = on<{ ranking: RankingEntry[] }>('scoreboard', ({ ranking }) => {
      setLastRanking(ranking)
      const own = stored ? ranking.find((entry) => entry.playerId === stored.playerId) : undefined
      if (own) {
        setLastAward(own.score - scoreRef.current)
        scoreRef.current = own.score
        setScore(own.score)
      }
    })

    const offPodium = on<{ top: RankingEntry[]; hasScoredQuestions?: boolean }>(
      'podium',
      ({ top, hasScoredQuestions: scored }) => {
        setPodiumTop(top)
        setHasScoredQuestions(scored !== false)
        setAutoNextAt(null)
        setPhase('podium')
      },
    )

    const offAuto = on<{ nextAt: number | null }>('auto:advance', ({ nextAt }) => {
      setAutoNextAt(nextAt)
    })

    // Compteur du lobby (« manchots sur la glace ») : `lobby:count` porte le
    // nombre de joueurs connectés, diffusé de façon coalescée à chaque arrivée
    // ou reconnexion. La liste des pseudos (`lobby:update`) est réservée à
    // l'hôte et au grand écran : le joueur n'en reçoit jamais.
    const offLobby = on<{ count: number }>('lobby:count', ({ count }) => {
      setLobbyCount(count)
    })

    return () => {
      cancelled = true
      offConnect()
      offDisconnect()
      offRelaunch()
      offKicked()
      offReading()
      offShow()
      offTimer()
      offReveal()
      offScoreboard()
      offPodium()
      offLobby()
      offAuto()
    }
    // Un seul montage : `emitAck`/`on` sont stables pour la durée de vie du
    // composant (voir useGameSocket.ts), `stored` ne change jamais après le
    // premier rendu (chargé une fois dans `storedRef`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------------- */
  /* Chrono — dérivé de `startedAt` serveur, jamais d'un chrono local seul */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!timer || phase !== 'question') return
    function tick() {
      if (!timer) return
      if (timer.startedAt === null) {
        setRemaining(timer.timeLimit)
        return
      }
      const elapsedMs = Date.now() - timer.startedAt
      const remainingSeconds = Math.max(0, Math.ceil((timer.timeLimit * 1000 - elapsedMs) / 1000))
      setRemaining(remainingSeconds)
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [timer, phase])

  // Compte à rebours inter-étapes (enchaînement automatique) — dérivé de l'horodatage serveur
  // `autoNextAt`, comme le chrono de question (jamais un minuteur local autonome).
  useEffect(() => {
    if (autoNextAt === null) {
      setAutoRemaining(null)
      return
    }
    function tick() {
      if (autoNextAt === null) return
      setAutoRemaining(Math.max(0, Math.ceil((autoNextAt - Date.now()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [autoNextAt])

  // Cue sonore/visuel d'urgence quand il reste 5 s — fixée une seule fois au
  // passage à 5 (les ticks suivants ne re-déclenchent pas la même valeur).
  useEffect(() => {
    if (phase === 'question' && remaining === 5) cue('timer.urgent')
  }, [remaining, phase])

  // Temps écoulé sans action du joueur : verrouille sur l'état « répondu »,
  // comme un envoi (mais `hasSubmission()` restera faux → message « temps
  // écoulé »).
  useEffect(() => {
    if (phase === 'question' && remaining === 0) {
      setPhase('answered')
    }
  }, [phase, remaining])

  // WCAG 2.4.3 : la soumission désactive le contrôle de réponse focalisé, le
  // focus tomberait sur <body>. Le déplacer vers le message de confirmation
  // — ou vers le message de rejet s'il y en a un (y compris quand un rejet
  // retryable rouvre la question : `answerRejection` seul suffit à
  // déclencher le focus, sans dépendre de `phase`).
  useEffect(() => {
    if (phase === 'answered' || answerRejection) answeredRef.current?.focus()
  }, [phase, answerRejection])

  // Annonce le « moment phare » : à l'arrivée d'une NOUVELLE question (ou de
  // sa phase de lecture, qui la précède — voir `phase === 'reading'` plus
  // bas, qui réutilise CE MÊME `promptRef` sur son propre titre), le focus va
  // sur l'intitulé pour qu'un lecteur d'écran le lise en premier. Gardé sur
  // `[question, reading]` (et non `phase`) : un rejet retryable remet aussi
  // `phase` à 'question' sans changer `question` — cet effet ne doit PAS
  // reprendre le focus au message de rejet dans ce cas.
  useEffect(() => {
    if (question || reading) promptRef.current?.focus()
  }, [question, reading])

  // Le résultat ('result') est le moment le plus important de la manche pour le joueur — au même
  // titre que la nouvelle question ci-dessus, mais sans effet dédié jusqu'ici (Plan 06 review,
  // finding #3) : sans ce focus explicite, le contrôle de réponse (bouton/tuile) disparaît du DOM
  // en repassant en 'question'→'result' et le focus retombe sur <body>, et le `role="status"`
  // fraîchement inséré n'est pas fiablement annoncé par tous les lecteurs d'écran. Même
  // traitement que `promptRef`/`podiumHeadingRef` ci-dessus/dessous.
  useEffect(() => {
    if (phase === 'result') resultHeadingRef.current?.focus()
  }, [phase])

  // Le podium remplace tout l'écran comme la carte de confirmation de /join —
  // même traitement : déplacer le focus sur son titre.
  useEffect(() => {
    if (phase === 'podium') podiumHeadingRef.current?.focus()
  }, [phase])

  // La bannière « Reconnecté » ne doit pas rester affichée toute la partie.
  useEffect(() => {
    if (connection !== 'reconnected') return
    const timeout = window.setTimeout(() => setConnection('online'), 3000)
    return () => window.clearTimeout(timeout)
  }, [connection])

  // Focus sur le titre de l'écran d'exclusion (rendu plus bas, après le dernier hook).
  useEffect(() => {
    if (kicked) kickedHeadingRef.current?.focus()
  }, [kicked])

  if (!stored) {
    return <Navigate to="/join" replace />
  }

  const myRank = (() => {
    const index = lastRanking.findIndex((entry) => entry.playerId === stored.playerId)
    return index === -1 ? null : index + 1
  })()

  const answeredMessage =
    question?.type === 'wordcloud'
      ? 'Temps écoulé, merci pour tes idées'
      : question?.type === 'poll'
        ? answerAccepted
          ? 'Vote enregistré'
          : 'Temps écoulé. En attente de la suite…'
        : hasSubmission()
          ? 'Réponse enregistrée. En attente de la suite…'
          : 'Temps écoulé. En attente de la suite…'

  // Ce que le serveur a réellement compté pour cette manche — `null`/vide si
  // la réponse n'a jamais été acceptée (rejetée, jamais soumise, temps
  // écoulé). Utilisé PARTOUT où on affiche « la » réponse du joueur, pour ne
  // jamais faire passer un choix local rejeté pour une réponse retenue.
  const effectiveMcqOptionIndex = answerAccepted ? mcqOptionIndex : null
  const effectiveBoolChoice = answerAccepted ? boolChoice : null
  const effectiveTextValue = answerAccepted ? textValue : ''
  const effectiveSliderValue = answerAccepted && sliderTouched ? sliderValue : null

  function evaluation(): { kind: ResultKind; diff: number | null } | null {
    if (!question || !revealPayload) return null
    switch (question.type) {
      case 'mcq':
        return { kind: evaluateMcq(revealPayload.correct as McqCorrect, effectiveMcqOptionIndex), diff: null }
      case 'truefalse':
        return {
          kind: evaluateTrueFalse(revealPayload.correct as TrueFalseCorrect, effectiveBoolChoice),
          diff: null,
        }
      case 'text':
        return { kind: evaluateText(revealPayload.correct as TextCorrect, effectiveTextValue), diff: null }
      case 'slider':
        return evaluateSlider(revealPayload.correct as SliderCorrect, effectiveSliderValue)
      case 'wordcloud':
      case 'poll':
        return null
    }
  }

  // Présentation de la bonne réponse sur le verdict (états raté / temps
  // écoulé, et — pour slider — toujours). La VÉRITÉ reste `evaluation()` : ici
  // on ne fait qu'AFFICHER `revealPayload.correct` et, le cas échéant, le choix
  // réellement comptabilisé du joueur (`effectiveXxx`, jamais un choix local
  // rejeté).
  function renderVerdictAnswer() {
    if (!question || !revealPayload) return null
    switch (question.type) {
      case 'mcq': {
        const correct = revealPayload.correct as McqCorrect
        const ci = correct.options.findIndex((o) => o.correct)
        const shape = MCQ_SHAPES[(ci < 0 ? 0 : ci) % MCQ_SHAPES.length]
        const chosen = effectiveMcqOptionIndex
        const wrong = chosen !== null && !correct.options[chosen]?.correct
        return (
          <>
            <div className="player-answer-tile" style={tileVars(shape)}>
              <span className="player-answer-tile__shape">
                <AnswerShape shape={shape} size={40} />
              </span>
              <span>
                {correct.options[ci]?.label}
                <span className="visually-hidden"> (bonne réponse)</span>
              </span>
            </div>
            {wrong && (
              <span className="player-verdict__your">
                <AnswerShape shape={MCQ_SHAPES[chosen % MCQ_SHAPES.length]} size={20} />
                Ton choix : {correct.options[chosen]?.label}
              </span>
            )}
          </>
        )
      }
      case 'truefalse': {
        const correct = revealPayload.correct as TrueFalseCorrect
        const shape: TileShape = correct.correct ? 'triangle' : 'diamond'
        const chose = effectiveBoolChoice
        const wrong = chose !== null && chose !== correct.correct
        return (
          <>
            <div className="player-answer-tile" style={tileVars(shape)}>
              <span className="player-answer-tile__shape">
                <AnswerShape shape={shape} size={40} />
              </span>
              <span>
                {correct.correct ? 'Vrai' : 'Faux'}
                <span className="visually-hidden"> (bonne réponse)</span>
              </span>
            </div>
            {wrong && (
              <span className="player-verdict__your">
                <AnswerShape shape={chose ? 'triangle' : 'diamond'} size={20} />
                Ton choix : {chose ? 'Vrai' : 'Faux'}
              </span>
            )}
          </>
        )
      }
      case 'text': {
        const correct = revealPayload.correct as TextCorrect
        const answers = correct.answers.filter((a) => a.trim().length > 0)
        return (
          <>
            <div className="player-answer-tile player-answer-tile--neutral">
              <span>
                {answers.join(', ')}
                <span className="visually-hidden"> (réponse acceptée)</span>
              </span>
            </div>
            {effectiveTextValue.trim().length > 0 && (
              <span className="player-verdict__your">Ta réponse : {effectiveTextValue}</span>
            )}
          </>
        )
      }
      case 'slider': {
        const correct = revealPayload.correct as SliderCorrect
        return (
          <div className="player-verdict__recap">
            <div className="player-verdict__recap-line">Bonne valeur : {correct.correct}</div>
            <div className="player-verdict__recap-line">
              Ton estimation : {effectiveSliderValue !== null ? effectiveSliderValue : 'aucune'}
            </div>
          </div>
        )
      }
      case 'wordcloud':
      case 'poll':
        return null
    }
  }

  const evalResult = phase === 'result' ? evaluation() : null

  // Reconnexion en pleine question (Plan 06 review, finding #5) : `player:reconnect` re-émet
  // `question:show`, dont le handler remet systématiquement à zéro la réponse capturée
  // localement (`resetAnswer` — voir l'abonnement plus haut) — y compris pour un joueur qui AVAIT
  // déjà répondu avant la coupure. `evaluation()` retombe alors sur `effectiveXxx === null` →
  // verdict 'timeout', directement contredit un instant plus tard par un delta de scoreboard
  // positif (« Temps écoulé » juste au-dessus de « +850 points »). Un vrai correctif demanderait
  // un flag serveur distinguant « n'a vraiment pas répondu » de « a répondu avant une reconnexion »
  // (suivi Plan 7) ; côté client, on se contente de ne pas AFFICHER la contradiction : un delta de
  // score strictement positif pour cette manche est la preuve qu'UNE réponse a bien été retenue,
  // même si on ne sait plus laquelle.
  const reconnectMismatch = evalResult?.kind === 'timeout' && lastAward !== null && lastAward > 0

  // Cue de résultat — une seule fois par transition vers 'result'. `evalResult`/
  // `reconnectMismatch` sont volontairement absents des deps : ils sont
  // recalculés à chaque rendu à partir de `phase`/`revealPayload`/etc., et les
  // inclure redéclencherait la cue sur des rendus qui ne changent pas de phase
  // (même logique que les effets `phase === 'result'` ci-dessus).
  useEffect(() => {
    if (phase !== 'result' || !evalResult) return
    const win = reconnectMismatch || evalResult.kind === 'correct' || evalResult.kind === 'partial'
    // Série : +1 sur une réussite (y compris crédit partiel et réponse
    // comptée malgré une reconnexion), remise à zéro sinon. Calcul local
    // honnête — le serveur ne diffuse pas de « streak ».
    setStreak((s) => (win ? s + 1 : 0))
    // On passe l'élément du titre de résultat en `ctx.el` : c'est ce qui permet à
    // `pulseGreen`/`shake` (motion/effects.ts) de réellement animer quelque chose — sans
    // contexte, ces effets sont des no-op (voir le commentaire en tête d'effects.ts).
    if (win) cue('answer.correct', { el: resultHeadingRef.current ?? undefined })
    else if (evalResult.kind === 'incorrect') cue('answer.incorrect', { el: resultHeadingRef.current ?? undefined })
    // 'timeout' → aucun cue (le joueur n'a pas répondu)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Affichage « n / N » : positionnel, fourni par le serveur (projection
  // `question:show`) ; absent → on n'affiche pas de numéro (jamais inventé).
  const qShownIndex = typeof question?.index === 'number' ? question.index + 1 : null
  const qTotal = typeof question?.total === 'number' ? question.total : null
  // Barre de progression = fraction de temps restant (donnée réelle du chrono).
  const timeFraction = question ? Math.max(0, Math.min(1, (remaining ?? question.timeLimit) / question.timeLimit)) : 0
  const kicker =
    question?.type === 'truefalse'
      ? 'Vrai ou faux'
      : question?.type === 'slider'
        ? 'Curseur'
        : question?.type === 'text'
          ? 'Réponse libre'
          : question?.type === 'poll'
            ? 'Sondage'
            : null

  // Rendu prioritaire sur tout le reste (la session locale est déjà effacée).
  if (kicked) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <div className="join-head">
          <Logo />
          <h1 ref={kickedHeadingRef} tabIndex={-1}>
            L'animateur t'a retiré de la partie.
          </h1>
        </div>
        <Link className="ab-button ab-button--primary" to="/join">
          Rejoindre une partie
        </Link>
      </main>
    )
  }

  return (
    <main className="player-screen" id="contenu-principal" tabIndex={-1}>
      <SoundToggle className="ab-soundtoggle--fixed" />
      {connection !== 'online' && (
        <p className={`player-net player-net--${connection}`} role="status" aria-live="polite">
          {connection === 'reconnecting' ? 'Reconnexion…' : 'Reconnecté, score conservé.'}
        </p>
      )}

      {phase === 'waiting' && (
        <div className="player-lobby">
          <div role="status" className="visually-hidden">
            Tu as rejoint la partie. En attente du lancement.
          </div>

          <div className="player-lobby__top">
            <Logo compact />
            <span className="player-lobby__pin">PIN {stored.pin}</span>
          </div>

          <div className="player-lobby__hero">
            <h1>Tu es sur la banquise !</h1>
            <p style={{ color: 'var(--ink-dim)' }}>
              En attente de la colonie
              <span className="player-lobby__dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </p>
          </div>

          <WaddlePenguin />

          <div className="player-floe player-floe--back" aria-hidden="true" />
          <div className="player-floe player-floe--front" aria-hidden="true" />

          <div className="player-lobby__foot">
            <span className="player-namepill">
              {stored.nickname} <small>(toi)</small>
            </span>
            {lobbyCount !== null && (
              <span className="player-count">
                <b>{lobbyCount}</b>
                <span>{lobbyCount > 1 ? 'manchots sur la glace' : 'manchot sur la glace'}</span>
              </span>
            )}
            <span className="player-lobby__hint">
              Regarde le grand écran : la partie démarre dès que l'animateur la lance.
            </span>
          </div>
        </div>
      )}

      {phase === 'reading' && reading && (
        // Énoncé SEUL, AUCUNE tuile de réponse rendue — contrairement au bloc
        // 'question'/'answered' ci-dessous, ce bloc ne rend jamais les
        // contrôles de saisie (mcq/vrai-faux/texte/slider) : rien à masquer
        // ni désactiver explicitement, ils ne sont tout simplement PAS dans
        // le DOM tant que le serveur n'a pas diffusé `question:show` — cohérent
        // avec le rejet serveur des réponses hors phase 'question'
        // (`submitAnswer`, packages/game/src/engine.ts).
        <div className="player-question">
          <div className="player-question__spacer" />
          <h1 className="player-question__prompt" style={{ textAlign: 'center' }} tabIndex={-1} ref={promptRef}>
            {reading.prompt}
          </h1>
          <p className="player-status" role="status" aria-live="polite">
            Prépare-toi…
          </p>
          <div className="player-question__spacer" />
        </div>
      )}

      {(phase === 'question' || phase === 'answered') && question && (
        <div className="player-question">
          <div className="player-qhead">
            <span className="player-qnum">
              {qShownIndex !== null && (
                <>
                  {qShownIndex}
                  {qTotal !== null && <span> / {qTotal}</span>}
                </>
              )}
            </span>
            <TimerPill remainingSeconds={remaining ?? question.timeLimit} totalSeconds={question.timeLimit} />
          </div>
          <div className="player-qbar" aria-hidden="true">
            <div className="player-qbar__fill" style={{ width: `${timeFraction * 100}%` }} />
          </div>

          {kicker && <span className="player-qtag">{kicker}</span>}
          <h1 className="player-question__prompt" tabIndex={-1} ref={promptRef}>
            {question.prompt}
          </h1>

          <div className="player-question__spacer" />

          {phase === 'question' &&
            (question.type === 'mcq' ||
              question.type === 'truefalse' ||
              (question.type === 'poll' && !(question.payload as PollShowPayload).multiple)) && (
              <p className="player-commit-hint">Le premier appui valide ta réponse.</p>
            )}

          {question.type === 'mcq' && (
            <div className="player-tiles" role="group" aria-label="Réponses">
              {(question.payload as McqShowPayload).options.map((opt, index) => (
                <AnswerTile
                  key={index}
                  shape={MCQ_SHAPES[index % MCQ_SHAPES.length]}
                  label={opt.label}
                  selected={phase === 'answered' && mcqOptionIndex === index}
                  dimmed={phase === 'answered' && mcqOptionIndex !== index}
                  disabled={phase === 'answered'}
                  onClick={() => {
                    setMcqOptionIndex(index)
                    submitAnswer({ optionIndex: index })
                  }}
                />
              ))}
            </div>
          )}

          {question.type === 'truefalse' && (
            <div className="player-duo" role="group" aria-label="Réponses">
              {[true, false].map((val) => (
                <AnswerTile
                  key={String(val)}
                  shape={val ? 'triangle' : 'diamond'}
                  label={val ? 'Vrai' : 'Faux'}
                  selected={phase === 'answered' && boolChoice === val}
                  dimmed={phase === 'answered' && boolChoice !== val}
                  disabled={phase === 'answered'}
                  onClick={() => {
                    setBoolChoice(val)
                    submitAnswer({ value: val })
                  }}
                />
              ))}
            </div>
          )}

          {question.type === 'wordcloud' && (
            <PlayerWordcloud key={question.id} disabled={phase === 'answered'} submit={submitWord} />
          )}

          {question.type === 'poll' && (
            <PlayerPoll
              key={question.id}
              options={(question.payload as PollShowPayload).options}
              multiple={(question.payload as PollShowPayload).multiple}
              disabled={phase === 'answered'}
              selected={pollSelection}
              onSubmit={(optionIndexes) => {
                setPollSelection(optionIndexes)
                submitAnswer({ optionIndexes })
              }}
            />
          )}

          {question.type === 'text' && (
            <form
              className="player-text"
              onSubmit={(e) => {
                e.preventDefault()
                if (textValue.trim().length > 0) submitAnswer({ text: textValue })
              }}
            >
              <label htmlFor="player-text-input" className="visually-hidden">
                Ta réponse
              </label>
              <input
                id="player-text-input"
                type="text"
                maxLength={40}
                value={textValue}
                disabled={phase === 'answered'}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="Tape ta réponse…"
                autoComplete="off"
              />
              <div className="player-text__row">
                <span>Les accents et majuscules ne comptent pas.</span>
                <span className="player-text__count">{textValue.length}/40</span>
              </div>
              <button
                type="submit"
                className="player-cta"
                disabled={phase === 'answered' || textValue.trim().length === 0}
              >
                Envoyer
              </button>
            </form>
          )}

          {question.type === 'slider' &&
            (() => {
              const sp = question.payload as SliderShowPayload
              const clamp = (v: number) => Math.max(sp.min, Math.min(sp.max, v))
              return (
                <form
                  className="player-slider"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setSliderTouched(true)
                    submitAnswer({ value: sliderValue })
                  }}
                >
                  <div className="player-slider__value">
                    <output htmlFor="player-slider-input">{sliderValue}</output>
                  </div>
                  <label htmlFor="player-slider-input" className="visually-hidden">
                    Ton estimation (de {sp.min} à {sp.max})
                  </label>
                  <input
                    id="player-slider-input"
                    type="range"
                    min={sp.min}
                    max={sp.max}
                    value={sliderValue}
                    disabled={phase === 'answered'}
                    onChange={(e) => {
                      setSliderValue(Number(e.target.value))
                      setSliderTouched(true)
                    }}
                  />
                  <div className="player-slider__scale" aria-hidden="true">
                    <span>{sp.min}</span>
                    <span>{sp.max}</span>
                  </div>
                  <div className="player-slider__steps">
                    <button
                      type="button"
                      className="player-step"
                      aria-label="Diminuer"
                      disabled={phase === 'answered'}
                      onClick={() => {
                        setSliderValue((v) => clamp(v - 1))
                        setSliderTouched(true)
                      }}
                    >
                      −
                    </button>
                    <button type="submit" className="player-cta" disabled={phase === 'answered'}>
                      Valider
                    </button>
                    <button
                      type="button"
                      className="player-step"
                      aria-label="Augmenter"
                      disabled={phase === 'answered'}
                      onClick={() => {
                        setSliderValue((v) => clamp(v + 1))
                        setSliderTouched(true)
                      }}
                    >
                      +
                    </button>
                  </div>
                </form>
              )
            })()}

          {phase === 'answered' && !answerRejection && (
            <p className="player-answered" role="status" aria-live="polite" ref={answeredRef} tabIndex={-1}>
              {answeredMessage}
            </p>
          )}

          {answerRejection && (
            // role="alert" (pas juste status) : c'est une correction d'un
            // état affiché juste avant (« enregistrée ») — le joueur doit
            // être notifié de façon plus appuyée qu'une simple mise à jour.
            <p className="player-answered" role="alert" ref={answeredRef} tabIndex={-1}>
              {answerRejection}
            </p>
          )}
        </div>
      )}

      {phase === 'result' && question?.type === 'wordcloud' && (
        <div className="player-verdict player-verdict--timeout" role="status">
          <div className="player-verdict__spacer" />
          <h1 className="player-verdict__title" ref={resultHeadingRef} tabIndex={-1}>
            Merci pour tes idées
          </h1>
          <p className="player-verdict__sub">La question suivante arrive…</p>
          <div className="player-verdict__spacer" />
        </div>
      )}

      {phase === 'result' && question?.type === 'poll' && (
        <div className="player-verdict player-verdict--timeout" role="status">
          <div className="player-verdict__spacer" />
          <h1 className="player-verdict__title" ref={resultHeadingRef} tabIndex={-1}>
            Sondage clos
          </h1>
          <p className="player-verdict__sub">Regarde l'écran pour voir les résultats.</p>
          <div className="player-verdict__spacer" />
        </div>
      )}

      {phase === 'result' && !evalResult && question?.type !== 'wordcloud' && question?.type !== 'poll' && (
        // Rejoindre en pleine question (Plan 06 review, finding #2) : le serveur ne rejoue
        // `question:show` que sur `player:reconnect`, jamais sur `player:join` — un joueur qui
        // rejoint APRÈS le début d'une question a donc `question === null` quand
        // `question:reveal` fait passer la phase à 'result' juste après. `evaluation()` retourne
        // alors `null` (elle a besoin de `question` pour interpréter `revealPayload.correct`) :
        // sans ce repli explicite, l'écran resterait entièrement vide jusqu'à la question
        // suivante. Repli honnête plutôt qu'un rendu fabriqué à partir de rien.
        <div className="player-verdict player-verdict--timeout" role="status">
          <div className="player-verdict__spacer" />
          <h1 className="player-verdict__title" ref={resultHeadingRef} tabIndex={-1}>
            Résultat indisponible
          </h1>
          <p className="player-verdict__sub">La question suivante arrive…</p>
          <div className="player-verdict__spacer" />
        </div>
      )}

      {phase === 'result' &&
        evalResult &&
        (() => {
          const win = reconnectMismatch || evalResult.kind === 'correct' || evalResult.kind === 'partial'
          const stateClass = win ? 'juste' : evalResult.kind === 'timeout' ? 'timeout' : 'rate'
          const title = reconnectMismatch
            ? 'Réponse comptée'
            : evalResult.kind === 'timeout'
              ? 'Temps écoulé'
              : evalResult.kind === 'correct'
                ? 'Juste !'
                : evalResult.kind === 'partial'
                  ? `À ${evalResult.diff} près !`
                  : 'Raté'
          return (
            <div className={`player-verdict player-verdict--${stateClass}`} role="status">
              <div className="player-verdict__meta">
                <span>
                  {qShownIndex !== null && qTotal !== null ? `Question ${qShownIndex} / ${qTotal}` : 'Résultat'}
                </span>
                <span>{stored.nickname}</span>
              </div>

              <div className="player-verdict__spacer" />

              {win && !reconnectMismatch && evalResult.kind === 'correct' && (
                <svg className="player-verdict__check" width="132" height="132" viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="24" r="23" fill="#0b2545" />
                  <circle cx="24" cy="24" r="23" fill="none" stroke="#9fd3e6" strokeWidth="2" />
                  <path
                    className="draw"
                    d="M13 25 L21 32 L35 17"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}

              <h1 className="player-verdict__title" ref={resultHeadingRef} tabIndex={-1}>
                {title}
              </h1>

              {win && (
                <p className="player-verdict__points">
                  {lastAward === null ? '…' : `+${lastAward}`}
                  {evalResult.kind === 'partial' ? ' pts partiels' : ' pts'}
                </p>
              )}

              {win && streak >= 2 && (
                <div className="player-streak">
                  {Array.from({ length: Math.min(streak, 5) }).map((_, i) => (
                    <svg key={i} viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="7" fill="#00708c" />
                    </svg>
                  ))}
                  Série de {streak}
                </div>
              )}

              {!win && (
                <>
                  <p className="player-verdict__sub">
                    {evalResult.kind === 'timeout'
                      ? 'Pas de réponse à temps. La bonne réponse :'
                      : 'La banquise est glissante. La bonne réponse :'}
                  </p>
                  {renderVerdictAnswer()}
                </>
              )}

              <div className="player-verdict__spacer" />

              {myRank !== null && (
                <div className="player-rankbar">
                  <span className="player-rankbar__rank">
                    Tu es à la <strong>{placeOrdinal(myRank)}</strong> place
                    {lastRanking.length > 0 ? ` sur ${lastRanking.length}` : ''}
                  </span>
                  <span className="player-rankbar__score">{score.toLocaleString('fr-FR')}</span>
                </div>
              )}

              {autoRemaining !== null && (
                <p className="player-auto-countdown" aria-live="polite">
                  Question suivante dans {autoRemaining} s
                </p>
              )}
            </div>
          )
        })()}

      {phase === 'podium' && (
        <div className="player-result" role="status">
          {hasScoredQuestions ? (
            <>
              <h1 ref={podiumHeadingRef} tabIndex={-1}>
                Partie terminée !
              </h1>
              <p className="player-result__points">Score final : {score.toLocaleString('fr-FR')}</p>
              {myRank !== null ? (
                <p>
                  Tu termines à la {placeOrdinal(myRank)} place sur {lastRanking.length || podiumTop.length}.
                </p>
              ) : (
                <p>Merci d'avoir joué !</p>
              )}
              {podiumTop.length > 0 && (
                <ol className="player-result__recap">
                  {podiumTop.map((entry, index) => (
                    <li key={entry.playerId} className="player-result__recap-line">
                      <span>
                        {index + 1}. {entry.nickname} : {entry.score} points
                        {entry.playerId === stored.playerId ? ' (toi)' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <ClosingView headingRef={podiumHeadingRef} audience="player" />
          )}

          {/* Enchaîner une autre partie : on oublie l'identité de CETTE partie
              (sinon, de retour sur /play, PlayerLive tenterait de se reconnecter
              à la room terminée via `player:reconnect`) puis on renvoie vers
              /join, où le joueur saisit un nouveau code. */}
          <button
            type="button"
            className="player-cta player-result__rejoin"
            onClick={() => {
              clearPlayerSession()
              navigate('/join')
            }}
          >
            Rejoindre une autre partie
          </button>
        </div>
      )}
    </main>
  )
}
