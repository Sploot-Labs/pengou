import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { sliderTolerance } from '@splootlabs/quiz'
import { clearPlayerSession, loadPlayerSession } from '../realtime/playerSession'
import { useGameSocket } from '../realtime/useGameSocket'
import { AnswerTile, Button, TimerRing } from '../ui'

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

type QuestionKind = 'mcq' | 'truefalse' | 'text' | 'slider'

/** `question:show` — projection anti-triche : jamais de bonne réponse. */
interface QuestionShowPayload {
  id: string
  type: QuestionKind
  prompt: string
  timeLimit: number
  payload: unknown
}

interface McqShowPayload {
  options: { label: string }[]
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

interface RankingEntry {
  playerId: string
  nickname: string
  score: number
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
 * forme (triangle/losange/rond/carré) est une reconstitution purement
 * visuelle côté client — jamais un signal de correction. Cycle au-delà de 4
 * options (le schéma en autorise jusqu'à 6). */
type TileShape = 'triangle' | 'diamond' | 'circle' | 'square'
const MCQ_SHAPES: readonly TileShape[] = ['triangle', 'diamond', 'circle', 'square']

/** Repli des accents/casse — mêmes règles que `packages/quiz/src/text.ts`. */
function normalizeText(value: string, caseSensitive: boolean): string {
  const folded = value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return caseSensitive ? folded : folded.toLowerCase()
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

function evaluateSlider(
  correct: SliderCorrect,
  value: number | null,
): { kind: ResultKind; diff: number | null } {
  if (value === null) return { kind: 'timeout', diff: null }
  const diff = Math.abs(value - correct.correct)
  const tolerance = sliderTolerance(correct.min, correct.max)
  if (diff === 0) return { kind: 'correct', diff: 0 }
  if (diff <= tolerance) return { kind: 'partial', diff }
  return { kind: 'incorrect', diff }
}

type PlayerPhase = 'waiting' | 'question' | 'answered' | 'result' | 'podium'
type Connection = 'online' | 'reconnecting' | 'reconnected'

export function PlayerLive() {
  const navigate = useNavigate()
  const { socket, emitAck, on } = useGameSocket()

  // Chargé une seule fois : c'est l'identité de joueur anonyme (voir
  // realtime/playerSession.ts). Si absente, `/join` est la seule route valide.
  const storedRef = useRef(loadPlayerSession())
  const stored = storedRef.current

  const [phase, setPhase] = useState<PlayerPhase>('waiting')
  const [connection, setConnection] = useState<Connection>('online')
  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)

  const [question, setQuestion] = useState<QuestionShowPayload | null>(null)
  const [timer, setTimer] = useState<TimerPayload | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [lastAward, setLastAward] = useState<number | null>(null)
  const [lastRanking, setLastRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])

  // Réponse en cours de capture, remise à zéro à chaque nouvelle question.
  const [mcqOptionIndex, setMcqOptionIndex] = useState<number | null>(null)
  const [boolChoice, setBoolChoice] = useState<boolean | null>(null)
  const [textValue, setTextValue] = useState('')
  const [sliderValue, setSliderValue] = useState(0)
  const [sliderTouched, setSliderTouched] = useState(false)

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
  const podiumHeadingRef = useRef<HTMLHeadingElement>(null)

  function resetAnswer(q: QuestionShowPayload) {
    setMcqOptionIndex(null)
    setBoolChoice(null)
    setTextValue('')
    setSliderTouched(false)
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
    }
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
    setAnswerRejection(
      reason ? `Réponse non prise en compte : ${reason}` : 'Réponse non prise en compte.',
    )
    if (reason === 'réponse invalide pour ce type de question') {
      setPhase('question')
    }
  }

  async function submitAnswer(answer: unknown) {
    if (phase !== 'question') return
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
      setAnswerRejection(
        err instanceof Error ? `Réponse non envoyée (${err.message}).` : 'Réponse non envoyée.',
      )
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
      } catch {
        // joinToken invalide/périmé (ou PIN inconnu) : impossible de
        // continuer sans identité de joueur valide.
        if (cancelled) return
        clearPlayerSession()
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

    const offShow = on<QuestionShowPayload>('question:show', (view) => {
      setQuestion(view)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setLastAward(null)
      setAnswerAccepted(false)
      setAnswerRejection(null)
      resetAnswer(view)
      setPhase('question')
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

    const offPodium = on<{ top: RankingEntry[] }>('podium', ({ top }) => {
      setPodiumTop(top)
      setPhase('podium')
    })

    return () => {
      cancelled = true
      offConnect()
      offDisconnect()
      offShow()
      offTimer()
      offReveal()
      offScoreboard()
      offPodium()
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

  // Annonce le « moment phare » : à l'arrivée d'une NOUVELLE question, le
  // focus va sur son intitulé pour qu'un lecteur d'écran le lise en premier.
  // Gardé sur `[question]` seul (et non `phase`) : un rejet retryable remet
  // aussi `phase` à 'question' sans changer `question` — cet effet ne doit
  // PAS reprendre le focus au message de rejet dans ce cas.
  useEffect(() => {
    if (question) promptRef.current?.focus()
  }, [question])

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

  if (!stored) {
    return <Navigate to="/join" replace />
  }

  const myRank = (() => {
    const index = lastRanking.findIndex((entry) => entry.playerId === stored.playerId)
    return index === -1 ? null : index + 1
  })()

  const answeredMessage = hasSubmission()
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
    }
  }

  function renderRecap() {
    if (!question || !revealPayload) return null
    switch (question.type) {
      case 'mcq': {
        const correct = revealPayload.correct as McqCorrect
        return (
          <div className="player-tiles">
            {correct.options.map((opt, index) => (
              <AnswerTile
                key={index}
                shape={MCQ_SHAPES[index % MCQ_SHAPES.length]}
                label={opt.label}
                disabled
                reveal={opt.correct ? 'correct' : index === effectiveMcqOptionIndex ? 'incorrect' : null}
              />
            ))}
          </div>
        )
      }
      case 'truefalse': {
        const correct = revealPayload.correct as TrueFalseCorrect
        const correctLabel = correct.correct ? 'Vrai' : 'Faux'
        const chose = effectiveBoolChoice === null ? null : effectiveBoolChoice ? 'Vrai' : 'Faux'
        const wrong = chose !== null && effectiveBoolChoice !== correct.correct
        return (
          <>
            <div className="player-result__recap-line player-result__recap-line--correct">
              <span className="player-result__recap-mark" aria-hidden="true">
                ✓
              </span>
              <span>Bonne réponse : {correctLabel}</span>
            </div>
            {wrong && (
              <div className="player-result__recap-line player-result__recap-line--yours">
                <span className="player-result__recap-mark" aria-hidden="true">
                  ✕
                </span>
                <span>Votre réponse : {chose}</span>
              </div>
            )}
          </>
        )
      }
      case 'text': {
        const correct = revealPayload.correct as TextCorrect
        return (
          <div className="player-result__recap-line player-result__recap-line--correct">
            <span className="player-result__recap-mark" aria-hidden="true">
              ✓
            </span>
            <span>
              Réponse(s) acceptée(s) :{' '}
              {correct.answers.filter((a) => a.trim().length > 0).join(' · ')}
            </span>
          </div>
        )
      }
      case 'slider': {
        const correct = revealPayload.correct as SliderCorrect
        return (
          <>
            <div className="player-result__recap-line player-result__recap-line--correct">
              <span className="player-result__recap-mark" aria-hidden="true">
                ✓
              </span>
              <span>Valeur correcte : {correct.correct}</span>
            </div>
            <div className="player-result__recap-line">
              <span>Votre estimation : {effectiveSliderValue !== null ? effectiveSliderValue : '—'}</span>
            </div>
          </>
        )
      }
    }
  }

  const evalResult = phase === 'result' ? evaluation() : null

  return (
    <main className="player-screen" id="contenu-principal" tabIndex={-1}>
      <div className="player-status-bar">
        <span style={{ fontWeight: 700 }}>PIN {stored.pin}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>
          Score : {score}
        </span>
      </div>

      {connection !== 'online' && (
        <p className={`player-net player-net--${connection}`} role="status" aria-live="polite">
          {connection === 'reconnecting' ? 'Reconnexion…' : 'Reconnecté, score conservé.'}
        </p>
      )}

      {phase === 'waiting' && (
        <div className="player-waiting">
          <h1>En attente de la prochaine question…</h1>
          <p style={{ color: 'var(--ink-dim)' }}>
            Restez sur cet écran. La question suivante s’affichera automatiquement.
          </p>
        </div>
      )}

      {(phase === 'question' || phase === 'answered') && question && (
        <div className="player-question">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
            <TimerRing
              remainingSeconds={remaining ?? question.timeLimit}
              totalSeconds={question.timeLimit}
            />
          </div>
          <h1 className="player-question__prompt" tabIndex={-1} ref={promptRef}>
            {question.prompt}
          </h1>

          <div style={{ marginTop: 'var(--space-4)' }}>
            {phase === 'question' && (question.type === 'mcq' || question.type === 'truefalse') && (
              <p className="player-commit-hint">Le premier appui valide votre réponse.</p>
            )}

            {question.type === 'mcq' && (
              <div className="player-tiles">
                {(question.payload as McqShowPayload).options.map((opt, index) => (
                  <AnswerTile
                    key={index}
                    shape={MCQ_SHAPES[index % MCQ_SHAPES.length]}
                    label={opt.label}
                    selected={phase === 'answered' && mcqOptionIndex === index}
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
              <div className="player-truefalse">
                {[true, false].map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    className={`player-tf-btn${
                      phase === 'answered' && boolChoice === val ? ' player-tf-btn--selected' : ''
                    }`}
                    disabled={phase === 'answered'}
                    aria-pressed={phase === 'answered' && boolChoice === val}
                    onClick={() => {
                      setBoolChoice(val)
                      submitAnswer({ value: val })
                    }}
                  >
                    {val ? 'Vrai' : 'Faux'}
                  </button>
                ))}
              </div>
            )}

            {question.type === 'text' && (
              <form
                className="player-text-answer"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (textValue.trim().length > 0) submitAnswer({ text: textValue })
                }}
              >
                <label htmlFor="player-text-input" className="visually-hidden">
                  Votre réponse
                </label>
                <input
                  id="player-text-input"
                  type="text"
                  value={textValue}
                  disabled={phase === 'answered'}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Tapez votre réponse"
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  type="submit"
                  disabled={phase === 'answered' || textValue.trim().length === 0}
                >
                  Valider
                </Button>
              </form>
            )}

            {question.type === 'slider' && (
              <form
                className="player-slider-answer"
                onSubmit={(e) => {
                  e.preventDefault()
                  setSliderTouched(true)
                  submitAnswer({ value: sliderValue })
                }}
              >
                <output htmlFor="player-slider-input">{sliderValue}</output>
                <label htmlFor="player-slider-input" className="visually-hidden">
                  Votre estimation (de {(question.payload as SliderShowPayload).min} à{' '}
                  {(question.payload as SliderShowPayload).max})
                </label>
                <input
                  id="player-slider-input"
                  type="range"
                  min={(question.payload as SliderShowPayload).min}
                  max={(question.payload as SliderShowPayload).max}
                  value={sliderValue}
                  disabled={phase === 'answered'}
                  onChange={(e) => {
                    setSliderValue(Number(e.target.value))
                    setSliderTouched(true)
                  }}
                />
                <Button variant="primary" type="submit" disabled={phase === 'answered'}>
                  Valider
                </Button>
              </form>
            )}
          </div>

          {phase === 'answered' && !answerRejection && (
            <p
              className="player-answered"
              role="status"
              aria-live="polite"
              ref={answeredRef}
              tabIndex={-1}
            >
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

      {phase === 'result' && evalResult && (
        <div
          className={`player-result player-result--${
            evalResult.kind === 'correct'
              ? 'correct'
              : evalResult.kind === 'partial'
                ? 'partial'
                : 'incorrect'
          }`}
          role="status"
        >
          <h1>
            {evalResult.kind === 'timeout'
              ? 'Temps écoulé'
              : evalResult.kind === 'correct'
                ? 'Bonne réponse !'
                : evalResult.kind === 'partial'
                  ? `À ${evalResult.diff} près !`
                  : 'Mauvaise réponse'}
          </h1>
          <p className="player-result__points">
            {lastAward === null ? '…' : `+${lastAward}`}
            {evalResult.kind === 'partial' ? ' points partiels' : ' points'}
          </p>

          <div className="player-result__recap">{renderRecap()}</div>

          {myRank !== null && <p>Classement provisoire : {myRank}ᵉ place</p>}
        </div>
      )}

      {phase === 'podium' && (
        <div className="player-result" role="status">
          <h1 ref={podiumHeadingRef} tabIndex={-1}>
            Partie terminée !
          </h1>
          <p className="player-result__points">Score final : {score}</p>
          {myRank !== null ? (
            <p>Vous terminez {myRank}ᵉ place.</p>
          ) : (
            <p>Merci d’avoir joué !</p>
          )}
          {podiumTop.length > 0 && (
            <ol className="player-result__recap">
              {podiumTop.map((entry, index) => (
                <li key={entry.playerId} className="player-result__recap-line">
                  <span>
                    {index + 1}. {entry.nickname} — {entry.score} points
                    {entry.playerId === stored.playerId ? ' (vous)' : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </main>
  )
}
