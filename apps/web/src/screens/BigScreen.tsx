import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  AnimatedBar,
  Confetti,
  CountUp,
  PhaseTransition,
  useCue,
  useFocusOnMount,
  useReducedMotion,
  useSound,
} from '../motion/index.js'
import { isScoredType, pollPercent } from '@splootlabs/quiz'
import { boardEntries } from '../realtime/board'
import { buildDistributionRows, pollRows, type QuestionKind } from '../realtime/distribution'
import { useGameSocket } from '../realtime/useGameSocket'
import type { ContentSource } from '../api/quizzes'
import type {
  PodiumPayload,
  PollView,
  RankingEntry,
  ReadingView,
  SessionRelaunchedView,
  WordcloudView,
} from '../realtime/contracts'
import { BigWordCloud } from '../ui/wordcloud/BigWordCloud'
import { wordcloudSummary } from '../ui/WordCloud'
import { hardReload } from '../realtime/hardReload'
import { ThemeProvider } from '../theme/ThemeProvider.js'
import { AnswerShape, JoinInvite, Logo, PinDisplay, SoundToggle, TimerRing } from '../ui'
import { PodiumCredits } from '../ui/SourceCredit'
import { ClosingView, ConversionFooter, PodiumView } from './Podium'

/**
 * Grand écran réel, lecture seule — câblé sur `apps/server/src/game-gateway.ts`
 * via `screen:join {displayToken}`. Une socket dédiée à ce montage (pas la
 * socket partagée hôte — voir `realtime/GameSocketProvider.tsx` : le grand
 * écran a son propre rôle `'screen'`, indépendant de l'hôte). Plus aucune
 * donnée mockée : tout vient des événements diffusés à la room de session.
 */

/* ------------------------------------------------------------------ */
/* Contrat serveur (types locaux — pas de mock)                        */
/* ------------------------------------------------------------------ */

interface QuestionShowPayload {
  id: string
  type: QuestionKind
  prompt: string
  timeLimit: number
  payload: unknown
}

/** Projection « lecture seule » émise par `question:reading` (Task 3, moteur
 * `readingView`) — DÉLIBÉRÉMENT sans `id`/`type`/`payload`/options : le grand
 * écran ne doit rien pouvoir afficher qui ressemble à une réponse pendant la
 * lecture (anti-triche, cohérent avec le moteur qui ne les envoie pas). */
interface McqShowPayload {
  options: { label: string }[]
}
/** Projection joueur d'un sondage : les choix du QCM, plus le mode de réponse. */
interface PollShowPayload extends McqShowPayload {
  multiple?: boolean
}
interface SliderShowPayload {
  min: number
  max: number
}

interface TimerPayload {
  timeLimit: number
  startedAt: number | null
}

interface RevealPayload {
  correct: unknown
  distribution: Record<string, number>
  /** Présent pour un sondage seulement : sa répartition (pas de bonne réponse). */
  poll?: PollView
}

interface LobbyPlayer {
  id: string
  nickname: string
  score: number
  connected: boolean
}

type Phase = 'lobby' | 'reading' | 'question' | 'reveal' | 'scoreboard' | 'podium'
type JoinState = 'connecting' | 'joined' | 'error'

/** Le grand écran n'a AUCUN contrôle propre (lecture seule) : contrairement à
 * `HostLive`, où l'hôte clique « Afficher le classement » une fois prêt, la
 * projection doit avancer TOUTE SEULE de la révélation vers le classement.
 * Or le serveur émet `question:reveal` ET `scoreboard` pour un seul et même
 * `host:reveal`/`host:skip` (voir `doReveal`, game-gateway.ts) — il n'y a
 * aucun second signal serveur pour cadencer cette transition. On tient donc
 * l'écran de révélation un temps fixe avant de basculer, en utilisant les
 * données déjà reçues (aucune donnée inventée, seulement un délai d'affichage
 * choisi côté front). */
const REVEAL_HOLD_MS = 5000

function BigScreenInner() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const pin = searchParams.get('pin')
  const quizTitle = searchParams.get('title') ?? 'Le quiz en direct, open-source.'

  const { socket, emitAck, on } = useGameSocket()
  const cue = useCue()
  const sound = useSound()
  const reducedMotion = useReducedMotion()

  const [joinState, setJoinState] = useState<JoinState>(token ? 'connecting' : 'error')
  const [joinError, setJoinError] = useState<string | null>(
    token ? null : "Lien invalide : jeton d'affichage manquant dans l'URL.",
  )
  const joinAttemptedRef = useRef(false)
  // `true` une fois `screen:join` réellement réussi au moins une fois — sert
  // à distinguer, après une coupure réseau, un échec de RE-jointure (message
  // actionnable spécifique) d'un tout premier échec (message serveur brut,
  // déjà géré ci-dessous).
  const hasJoinedOnceRef = useRef(false)
  // Reflète l'état de transport Socket.IO, INDÉPENDAMMENT de `joinState` :
  // sans `connectionStateRecovery` côté serveur (aucun configuré — voir
  // `apps/server/src/realtime.ts`), toute coupure réseau fait renaître la
  // socket avec un `socket.id`/`socket.data` neufs et SANS ré-appartenance à
  // la room de session au reconnect — sans ce suivi, l'écran resterait figé
  // sur son dernier contenu, sans le moindre signe qu'il ne reçoit plus rien.
  const [connection, setConnection] = useState<'online' | 'reconnecting'>('online')

  const [phase, setPhase] = useState<Phase>('lobby')
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [announcement, setAnnouncement] = useState('')

  const [reading, setReading] = useState<ReadingView | null>(null)
  const [readingRemaining, setReadingRemaining] = useState<number | null>(null)
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null)
  const [timer, setTimer] = useState<TimerPayload | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [progressAnswered, setProgressAnswered] = useState(0)
  const [wordcloud, setWordcloud] = useState<WordcloudView | null>(null)

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])
  const [podiumSources, setPodiumSources] = useState<ContentSource[]>([])
  const [hasScoredQuestions, setHasScoredQuestions] = useState(true)

  // Enchaînement automatique : horodatage serveur de la prochaine bascule (diffusé par
  // `auto:advance`), reflété en compte à rebours — jamais un minuteur local indépendant.
  const [autoNextAt, setAutoNextAt] = useState<number | null>(null)
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null)

  const focusPhaseHeading = useFocusOnMount<HTMLHeadingElement>()

  /* ---------------------------------------------------------------- */
  /* screen:join — une seule tentative (jeton à usage unique)           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!token) return
    let cancelled = false

    async function join() {
      if (joinAttemptedRef.current) return
      joinAttemptedRef.current = true
      try {
        await emitAck('screen:join', { displayToken: token })
        if (cancelled) return
        hasJoinedOnceRef.current = true
        setConnection('online')
        setJoinState('joined')
      } catch (err) {
        if (cancelled) return
        setJoinState('error')
        setJoinError(
          // Une coupure réseau après une jointure réussie fait renaître la
          // socket (nouveau socket.id/socket.data, room perdue) : le
          // prochain `screen:join` réutilise FORCÉMENT le même jeton — à
          // usage unique, il a déjà été consommé par la première jointure.
          // Message actionnable plutôt que la string technique du serveur
          // (« displayToken invalide ou déjà utilisé »), qui ne dirait pas
          // à l'opérateur QUOI FAIRE.
          hasJoinedOnceRef.current
            ? "Lien grand écran expiré après une coupure réseau. Demandez un nouveau lien à l'hôte."
            : err instanceof Error
              ? err.message
              : 'Connexion au grand écran impossible.',
        )
      }
    }

    if (socket.connected) void join()
    const offConnect = on('connect', () => void join())
    const offDisconnect = on('disconnect', () => {
      setConnection('reconnecting')
      // Autorise une nouvelle tentative au prochain `connect` (voir le
      // commentaire de `hasJoinedOnceRef` ci-dessus) — elle échouera très
      // probablement (jeton à usage unique déjà consommé), mais ÉCHOUERA
      // VISIBLEMENT (voir le catch de `join()`), jamais en gelant l'écran
      // silencieusement sur son dernier contenu.
      joinAttemptedRef.current = false
    })
    return () => {
      cancelled = true
      offConnect()
      offDisconnect()
    }
    // Un seul montage : `token` ne change jamais après le premier rendu (lu
    // depuis l'URL).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  /* ---------------------------------------------------------------- */
  /* Abonnements — un seul montage                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const offLobby = on<{ players: LobbyPlayer[] }>('lobby:update', ({ players: list }) => {
      setPlayers(list)
    })

    const offReading = on<ReadingView>('question:reading', (view) => {
      setReading(view)
      setReadingRemaining(null)
      // Même reset qu'à `question:show` ci-dessous — la phase lecture précède
      // la phase question de la MÊME manche, mais on ne veut aucune donnée de
      // la manche PRÉCÉDENTE qui traîne à l'écran pendant la lecture.
      setQuestion(null)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setProgressAnswered(0)
      setRanking([])
      setAutoNextAt(null)
      cue('phase.enter:reading')
      setPhase('reading')
    })

    const offShow = on<QuestionShowPayload>('question:show', (view) => {
      setQuestion(view)
      setReading(null)
      setReadingRemaining(null)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setProgressAnswered(0)
      // Le nuage n'est effacé que si la question change (le serveur rejoue `question:show`
      // puis `wordcloud:update` à la reconnexion de la même question).
      setWordcloud((prev) => (prev && prev.questionId === view.id ? prev : null))
      // Reset volontaire (contrairement à HostLive, qui garde le dernier
      // classement connu pour son aside) : sert de garde pour l'effet de
      // bascule auto reveal→scoreboard ci-dessous (voir REVEAL_HOLD_MS) — il
      // ne doit jamais se déclencher sur les données de la question PRÉCÉDENTE.
      setRanking([])
      setAutoNextAt(null)
      cue('phase.enter:question')
      setPhase('question')
    })

    const offTimer = on<TimerPayload>('timer', (t) => {
      setTimer(t)
    })

    const offProgress = on<{ answered: number; total: number }>('screen:progress', ({ answered }) => {
      setProgressAnswered(answered)
    })

    const offWordcloud = on<WordcloudView>('wordcloud:update', (v) => {
      setWordcloud(v)
    })

    const offReveal = on<RevealPayload>('question:reveal', (r) => {
      setRevealPayload(r)
      cue('phase.enter:reveal')
      setPhase('reveal')
    })

    const offScoreboard = on<{ ranking: RankingEntry[] }>('scoreboard', ({ ranking: r }) => {
      setRanking(r)
    })

    const offPodium = on<PodiumPayload>('podium', ({ top, ranking: full, sources, hasScoredQuestions: scored }) => {
      setPodiumTop(top)
      if (full) setRanking(full)
      setHasScoredQuestions(scored !== false)
      setPodiumSources(sources ?? [])
      setAutoNextAt(null)
      cue('phase.enter:podium')
      setPhase('podium')
    })

    const offAuto = on<{ nextAt: number | null }>('auto:advance', ({ nextAt }) => {
      setAutoNextAt(nextAt)
    })

    // Relance depuis le podium : recharge complet vers le nouveau grand écran
    // (le `screen:join` du remontage consomme le nouveau jeton, à usage unique).
    const offRelaunch = on<SessionRelaunchedView>('session:relaunched', (v) => {
      if (v.role !== 'screen') return
      const u = new URL('/screen/' + v.sessionId, window.location.origin)
      u.searchParams.set('token', v.displayToken)
      u.searchParams.set('pin', v.pin)
      if (quizTitle) u.searchParams.set('title', quizTitle)
      hardReload(u.pathname + u.search)
    })

    return () => {
      offRelaunch()
      offLobby()
      offReading()
      offShow()
      offTimer()
      offProgress()
      offWordcloud()
      offReveal()
      offScoreboard()
      offPodium()
      offAuto()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bascule auto révélation → classement (voir le commentaire de
  // REVEAL_HOLD_MS) : seulement une fois le VRAI `scoreboard` de cette manche
  // arrivé (jamais sur un `ranking` resté vide depuis le reset ci-dessus).
  // Jamais après une question non notée (sondage, nuage de mots) : le serveur émet quand même
  // `scoreboard`, mais l'écran reste sur la révélation jusqu'à la question suivante.
  const revealedType = question?.type ?? null
  useEffect(() => {
    if (phase !== 'reveal' || ranking.length === 0) return
    if (revealedType !== null && !isScoredType(revealedType)) return
    const t = window.setTimeout(() => {
      cue('phase.enter:scoreboard')
      setPhase('scoreboard')
    }, REVEAL_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [phase, ranking, revealedType])

  // Décompte de lecture — même dérivation que le chrono de réponse ci-dessous
  // (`startedAt` + durée serveur, jamais un minuteur local indépendant) :
  // c'est le serveur qui planifie la bascule vers `question:show`, ce décompte
  // ne fait que la REFLÉTER pour l'affichage. Valeur toujours rendue en texte
  // (RGAA — jamais la seule animation/couleur qui porte l'information).
  useEffect(() => {
    if (!reading || phase !== 'reading') return
    function tick() {
      if (!reading) return
      if (reading.startedAt === null) {
        setReadingRemaining(reading.readingTime)
        return
      }
      const elapsedMs = Date.now() - reading.startedAt
      const remainingSeconds = Math.max(0, Math.ceil((reading.readingTime * 1000 - elapsedMs) / 1000))
      setReadingRemaining(remainingSeconds)
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [reading, phase])

  // Chrono — dérivé de `startedAt` serveur, comme PlayerLive/HostLive.
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

  // Cue sonore d'urgence à 5 s restantes (comme PlayerLive) — fixée une seule
  // fois au passage à 5, les ticks suivants ne re-déclenchent pas la valeur.
  useEffect(() => {
    if (phase === 'question' && remaining === 5) cue('timer.urgent')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase])

  // Ambiance sonore du lobby : nappe « banquise » en boucle tant qu'on attend
  // les joueurs, coupée dès qu'une manche commence (et à l'unmount). Reste un
  // no-op tant que le son n'est pas déverrouillé (voir l'effet de geste
  // ci-dessous) ou si l'opérateur a coupé le son.
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
    if (phase === 'lobby') sound.loop('lobby')
    else sound.stop('lobby')
  }, [phase, sound])

  useEffect(() => () => sound.stop('lobby'), [sound])

  // Le grand écran est passif (aucun contrôle de jeu) : son audio ne se
  // déverrouille qu'au 1er geste de l'opérateur dans l'onglet. Comme le lobby
  // est la toute première phase, l'ambiance ne peut pas démarrer avant ce
  // geste — on la (re)lance donc ici, une fois le contexte audio amorcé.
  useEffect(() => {
    const start = () => {
      sound.unlock()
      if (phaseRef.current === 'lobby') sound.loop('lobby')
    }
    window.addEventListener('pointerdown', start, { once: true })
    window.addEventListener('keydown', start, { once: true })
    return () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
  }, [sound])

  // Compte à rebours inter-étapes (enchaînement automatique) — dérivé de l'horodatage serveur
  // `autoNextAt`, comme les autres chronos (jamais un minuteur local autonome).
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

  // Annonce debouncée de l'arrivée des joueurs (lobby uniquement).
  useEffect(() => {
    if (phase !== 'lobby') return
    const t = window.setTimeout(() => {
      if (players.length === 0) return
      const verb = players.length > 1 ? 'ont' : 'a'
      setAnnouncement(`${players.length} joueur${players.length > 1 ? 's' : ''} ${verb} rejoint la partie.`)
    }, 600)
    return () => window.clearTimeout(t)
  }, [phase, players])

  if (joinState === 'error') {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {joinError}
        </p>
        <p style={{ color: 'var(--ink-dim)' }}>Générez un nouveau lien depuis le contrôleur hôte (« Grand écran »).</p>
      </main>
    )
  }

  if (joinState === 'connecting') {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Connexion au grand écran…</p>
      </main>
    )
  }

  // Répartition d'un sondage : seulement si elle porte sur la question affichée (course entre
  // événements, comme pour le nuage).
  const poll =
    question?.type === 'poll' && revealPayload?.poll && revealPayload.poll.questionId === question.id
      ? revealPayload.poll
      : null
  const rows =
    phase === 'reveal' && question && revealPayload
      ? poll
        ? pollRows(poll)
        : buildDistributionRows(question.type, revealPayload.correct, revealPayload.distribution)
      : null
  // Question nuage en cours ou en révélation : rendue par un sous-arbre unique (voir plus bas).
  const cloudLive = question?.type === 'wordcloud' && (phase === 'question' || phase === 'reveal')
  const maxCount = rows && rows.length > 0 ? Math.max(1, ...rows.map((r) => r.count)) : 1

  function renderWordcloud(foot?: ReactNode) {
    // Un nuage d'une autre question (course entre événements) n'est jamais affiché.
    const current = wordcloud && question && wordcloud.questionId === question.id ? wordcloud : null
    return (
      <div className="big-wordcloud">
        {/* Cadre qui prend toute la hauteur restante : le nuage 2 / 1 s'y inscrit sans défilement. */}
        <div className="big-wordcloud__frame">
          <BigWordCloud
            key={question?.id}
            words={current?.words ?? []}
            revealed={phase === 'reveal'}
            reducedMotion={reducedMotion}
          />
        </div>
        <div className="big-wordcloud__foot">
          {current && <p className="big-live__answered">{wordcloudSummary(current)}</p>}
          {foot}
        </div>
      </div>
    )
  }

  function renderLiveAnswers() {
    if (!question) return null
    if (question.type === 'wordcloud') return renderWordcloud()
    if (question.type === 'mcq' || question.type === 'poll') {
      const shapes = ['triangle', 'diamond', 'circle', 'square'] as const
      return (
        <div className="big-answers">
          {(question.payload as McqShowPayload).options.map((opt, i) => {
            const shape = shapes[i % shapes.length]
            return (
              <div
                key={i}
                className="big-answer"
                style={{
                  ['--tile-color' as string]: `var(--ans-${shape})`,
                  ['--tile-ink' as string]: `var(--ans-${shape}-ink)`,
                }}
              >
                <AnswerShape shape={shape} size={36} />
                <span>{opt.label}</span>
              </div>
            )
          })}
        </div>
      )
    }
    if (question.type === 'truefalse') {
      return (
        <div className="big-answers big-answers--duo">
          <div className="big-answer big-answer--neutral">Vrai</div>
          <div className="big-answer big-answer--neutral">Faux</div>
        </div>
      )
    }
    if (question.type === 'slider') {
      const { min, max } = question.payload as SliderShowPayload
      return (
        <div className="big-answer__range">
          <span>
            De {min} à {max}
          </span>
        </div>
      )
    }
    return (
      <div className="big-answer__range">
        <span>Réponse libre : tapez sur votre mobile</span>
      </div>
    )
  }

  function renderDistribution() {
    if (question?.type === 'wordcloud') return renderWordcloud()
    if (poll && poll.voters === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>Aucun vote</p>
    }
    if (!rows || rows.length === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>Aucune réponse reçue pour cette question.</p>
    }
    return (
      <div className="big-distribution" style={{ ['--dist-cols' as string]: String(rows.length) }}>
        {rows.map((row) => (
          <div className={`big-distribution__col${row.correct ? ' big-distribution__col--correct' : ''}`} key={row.key}>
            <div className="big-distribution__bar-track">
              <div
                // La proportion (row.count / maxCount) est encodée UNE SEULE fois, par le
                // scaleY de <AnimatedBar> ci-dessous. Cette div ne fait que remplir le rail
                // (height: 100%) : lui redonner ici (row.count/maxCount)*100% doublerait
                // l'encodage (fill = ratio_outer × scaleY(ratio) = ratio² au lieu de ratio).
                className="big-distribution__bar"
                style={{ height: '100%' }}
              >
                <AnimatedBar
                  value={row.count}
                  max={maxCount}
                  color={row.shape ? `var(--ans-${row.shape})` : 'var(--brand-2)'}
                />
              </div>
            </div>
            <span className="big-distribution__label">
              {row.shape && <AnswerShape shape={row.shape} size={20} />}
              {row.label}
              {row.correct && (
                <span className="big-distribution__check" aria-hidden="true">
                  ✓
                </span>
              )}
              {row.correct && <span className="visually-hidden"> (bonne réponse)</span>}
            </span>
            {poll ? (
              <>
                <span className="big-distribution__count">
                  {row.count} vote{row.count > 1 ? 's' : ''}
                </span>
                <span className="big-distribution__count">
                  {pollPercent(row.count, poll.voters)}
                  {' '}%
                </span>
              </>
            ) : (
              <span className="big-distribution__count">
                {row.count} réponse{row.count > 1 ? 's' : ''}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <main className="big-screen" id="contenu-principal" tabIndex={-1}>
      <SoundToggle className="ab-soundtoggle--fixed" />
      {/* Coupure réseau : jamais un gel silencieux — voir le commentaire de
          `connection` plus haut. Superposé au contenu de phase (qui reste
          affiché tel quel derrière, faute de mieux à montrer) plutôt que de
          le remplacer, pour que la salle continue de voir le PIN/la
          question pendant la tentative de reconnexion. */}
      {connection === 'reconnecting' && (
        <p className="player-net player-net--reconnecting" role="alert">
          Connexion perdue, reconnexion…
        </p>
      )}
      {(phase === 'reading' || phase === 'question' || phase === 'reveal' || phase === 'scoreboard') && (
        <div className="big-join-reminder">
          Rejoignez sur <strong>{window.location.host}</strong>
          {pin && (
            <>
              {', '}
              code banquise <strong>{pin}</strong>
            </>
          )}
        </div>
      )}

      <PhaseTransition phaseKey={cloudLive ? `cloud-live-${question?.id}` : phase} className="big-phase-layer">
        {phase === 'lobby' && (
          <div className="big-lobby">
            <Logo />
            <div>
              <h1 className="ab-hero-title" ref={focusPhaseHeading} tabIndex={-1}>
                {quizTitle}
              </h1>
              <p className="big-lobby__tagline">Le quiz en direct, open-source.</p>
              <p className="big-lobby__proof">
                Rejoignez en 5 secondes, aucune appli à installer. Vos données restent chez vous.
              </p>
            </div>
            {pin ? (
              <div className="big-lobby__join">
                <PinDisplay pin={pin} />
                <JoinInvite pin={pin} />
              </div>
            ) : (
              <p style={{ color: 'var(--ink-dim)' }}>PIN indisponible, demandez-le à l'hôte.</p>
            )}

            {players.length === 0 ? (
              <p className="big-lobby__empty">En attente de la colonie… Saisissez le code banquise pour rejoindre.</p>
            ) : (
              <ul className="big-players" aria-label="Joueurs ayant rejoint la partie">
                {players.map((p) => (
                  <li key={p.id} className={`big-players__chip${!p.connected ? ' big-players__chip--off' : ''}`}>
                    {p.nickname}
                    {!p.connected && (
                      <span className="big-players__badge">
                        <span aria-hidden="true">⚠</span> déconnecté
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p role="status" aria-live="polite">
              {announcement}
            </p>
          </div>
        )}

        {phase === 'reading' && reading && (
          <div className="big-live big-live--reading">
            <div className="big-live__header">
              <span className="host-badge">Lecture en cours</span>
              <span className="big-live__reading-count" aria-hidden="true">
                {readingRemaining ?? reading.readingTime} s
              </span>
            </div>

            {/* L'énoncé SEUL — aucune option/réponse : le payload `question:reading`
              n'en contient d'ailleurs pas (voir `ReadingView` ci-dessus, anti-triche). */}
            <h1 className="big-live__prompt" ref={focusPhaseHeading} tabIndex={-1}>
              {reading.prompt}
            </h1>

            {/* Décompte textuel (pas seulement le badge décoratif aria-hidden
              ci-dessus) — RGAA : la valeur doit toujours être lisible, pas
              seulement visible/animée. `role="status"`/`aria-live="polite"`
              annonce la lecture en cours sans re-annoncer chaque tick (le
              texte du nœud change, mais son rôle status ne relit pas à
              chaque frame chez tous les lecteurs d'écran — cohérent avec le
              chrono de réponse, non annoncé en continu lui non plus). */}
            <p className="big-live__answered" role="status" aria-live="polite">
              Lecture : {readingRemaining ?? reading.readingTime} s restantes
            </p>
          </div>
        )}

        {/* Nuage : question et révélation partagent le même sous-arbre (et la même clé de transition),
          pour que le nuage reste monté et que sa disposition en direct soit figée à la révélation. */}
        {cloudLive && question && (
          <div className="big-live big-live--cloud">
            {/* En-tête compact sur une ligne. À la révélation, la place du chrono reste réservée :
              la question et le nuage gardent leur taille et leur position (la salle garde ses repères). */}
            <div className="big-live__header">
              <span className="host-badge">{phase === 'reveal' ? 'Révélation' : 'Question en cours'}</span>
              <h1 className="big-live__prompt" key={phase} ref={focusPhaseHeading} tabIndex={-1}>
                {question.prompt}
              </h1>
              {phase === 'question' ? (
                <TimerRing
                  remainingSeconds={remaining ?? question.timeLimit}
                  totalSeconds={question.timeLimit}
                  size={112}
                  large
                />
              ) : (
                <span className="big-live__ring-slot" aria-hidden="true" />
              )}
            </div>

            {renderWordcloud(
              phase === 'reveal' && autoRemaining !== null && (
                <p className="big-auto-countdown" role="status" aria-live="polite">
                  Question suivante dans {autoRemaining} s
                </p>
              ),
            )}
          </div>
        )}

        {phase === 'question' && question && !cloudLive && (
          <div className="big-live">
            <div className="big-live__header">
              <span className="host-badge">Question en cours</span>
              <TimerRing
                remainingSeconds={remaining ?? question.timeLimit}
                totalSeconds={question.timeLimit}
                size={180}
                large
              />
            </div>

            <h1 className="big-live__prompt" ref={focusPhaseHeading} tabIndex={-1}>
              {question.prompt}
            </h1>

            {question.type === 'poll' && (question.payload as PollShowPayload).multiple && (
              <p className="big-live__answered">Plusieurs réponses possibles</p>
            )}

            {renderLiveAnswers()}

            {question.type !== 'wordcloud' && (
              <p className="big-live__answered">
                {progressAnswered} / {players.length} {progressAnswered <= 1 ? 'a' : 'ont'} répondu
              </p>
            )}
          </div>
        )}

        {phase === 'reveal' && !cloudLive && (
          <div className="big-live">
            {question ? (
              <>
                <div className="big-live__header">
                  <span className="host-badge">Révélation</span>
                </div>

                <h1 className="big-live__prompt" ref={focusPhaseHeading} tabIndex={-1}>
                  {question.prompt}
                </h1>

                {renderDistribution()}

                {/* Question non notée (sondage, nuage) : l'écran reste sur la révélation, sans étape
                  classement, donc le compte à rebours d'enchaînement s'affiche ici. */}
                {!isScoredType(question.type) && autoRemaining !== null && (
                  <p className="big-auto-countdown" role="status" aria-live="polite">
                    Question suivante dans {autoRemaining} s
                  </p>
                )}
              </>
            ) : (
              // Repli DÉFENSIF (cas devenu rare depuis le lot hardening) : le serveur rejoue
              // désormais `question:show` à un écran qui rejoint en pleine question
              // (`replayCurrentQuestionTo`, appelé sur `screen:join` ET `screen:reconnect`,
              // game-gateway.ts) — l'écran a donc normalement la question. Ce repli ne subsiste
              // que pour la fenêtre de course résiduelle (ex. `question:reveal` traité avant le
              // `question:show` rejoué) : mieux vaut ce message honnête qu'un écran vide. La
              // bascule auto reveal→scoreboard ci-dessus ne dépend pas de `question`.
              <h1 className="big-live__prompt" ref={focusPhaseHeading} tabIndex={-1}>
                Résultat indisponible pour cette question, la suivante arrive.
              </h1>
            )}
          </div>
        )}

        {phase === 'scoreboard' && (
          <div className="big-scoreboard">
            <h1 className="ab-hero-title" ref={focusPhaseHeading} tabIndex={-1}>
              Classement
            </h1>
            {autoRemaining !== null && (
              <p className="big-auto-countdown" role="status" aria-live="polite">
                Question suivante dans {autoRemaining} s
              </p>
            )}
            {ranking.length === 0 ? (
              <p style={{ color: 'var(--ink-dim)' }}>Le classement s'affichera après la première question.</p>
            ) : (
              <ol className="big-scoreboard__list">
                {boardEntries(ranking, players)
                  .slice(0, 5)
                  .map((p, index) => (
                    <li key={p.playerId} className="big-scoreboard__row">
                      <span className={`big-scoreboard__rank${index === 0 ? ' big-scoreboard__rank--first' : ''}`}>
                        {index + 1}
                      </span>
                      <span className="big-scoreboard__name">{p.nickname}</span>
                      <span className="big-scoreboard__score">
                        <CountUp value={p.score} format={(n) => `${n} pts`} />
                      </span>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        )}

        {phase === 'podium' &&
          (hasScoredQuestions ? (
            <div style={{ position: 'relative' }}>
              <Confetti active />
              <PodiumView
                quizTitle={quizTitle}
                top={podiumTop}
                fullRanking={ranking}
                headingRef={focusPhaseHeading}
                sources={podiumSources}
                showConversionFooter
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)' }}>
              <ClosingView quizTitle={quizTitle} headingRef={focusPhaseHeading} audience="room" />
              <PodiumCredits sources={podiumSources} />
              <ConversionFooter />
            </div>
          ))}
      </PhaseTransition>
    </main>
  )
}

export function BigScreen() {
  return (
    <ThemeProvider theme="scene" scheme="dark">
      <BigScreenInner />
    </ThemeProvider>
  )
}
