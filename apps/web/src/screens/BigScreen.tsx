import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { buildDistributionRows, type QuestionKind } from '../realtime/distribution'
import { useGameSocket } from '../realtime/useGameSocket'
import { AnswerShape, Logo, PinDisplay, TimerRing } from '../ui'
import { PodiumView } from './Podium'

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
interface McqShowPayload {
  options: { label: string }[]
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
}

interface RankingEntry {
  playerId: string
  nickname: string
  score: number
}

interface LobbyPlayer {
  id: string
  nickname: string
  score: number
  connected: boolean
}

type Phase = 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'
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

export function BigScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const pin = searchParams.get('pin')
  const quizTitle = searchParams.get('title') ?? 'Le quiz en direct, open-source.'

  const { socket, emitAck, on } = useGameSocket()

  const [joinState, setJoinState] = useState<JoinState>(token ? 'connecting' : 'error')
  const [joinError, setJoinError] = useState<string | null>(
    token ? null : 'Lien invalide : jeton d’affichage manquant dans l’URL.',
  )
  const joinAttemptedRef = useRef(false)

  const [phase, setPhase] = useState<Phase>('lobby')
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [announcement, setAnnouncement] = useState('')

  const [question, setQuestion] = useState<QuestionShowPayload | null>(null)
  const [timer, setTimer] = useState<TimerPayload | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [progressAnswered, setProgressAnswered] = useState(0)

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])

  const phaseHeadingRef = useRef<HTMLHeadingElement>(null)
  const podiumHeadingRef = useRef<HTMLHeadingElement>(null)
  const isFirstRender = useRef(true)

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
        if (!cancelled) setJoinState('joined')
      } catch (err) {
        if (!cancelled) {
          setJoinState('error')
          setJoinError(
            err instanceof Error
              ? err.message
              : 'Connexion au grand écran impossible.',
          )
        }
      }
    }

    if (socket.connected) void join()
    const offConnect = on('connect', () => void join())
    return () => {
      cancelled = true
      offConnect()
    }
    // Une seule tentative de jointure pour la durée de vie du composant —
    // `token` ne change jamais après le premier rendu (lu depuis l'URL).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  /* ---------------------------------------------------------------- */
  /* Abonnements — un seul montage                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const offLobby = on<{ players: LobbyPlayer[] }>('lobby:update', ({ players: list }) => {
      setPlayers(list)
    })

    const offShow = on<QuestionShowPayload>('question:show', (view) => {
      setQuestion(view)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setProgressAnswered(0)
      // Reset volontaire (contrairement à HostLive, qui garde le dernier
      // classement connu pour son aside) : sert de garde pour l'effet de
      // bascule auto reveal→scoreboard ci-dessous (voir REVEAL_HOLD_MS) — il
      // ne doit jamais se déclencher sur les données de la question PRÉCÉDENTE.
      setRanking([])
      setPhase('question')
    })

    const offTimer = on<TimerPayload>('timer', (t) => {
      setTimer(t)
    })

    const offProgress = on<{ answered: number; total: number }>('screen:progress', ({ answered }) => {
      setProgressAnswered(answered)
    })

    const offReveal = on<RevealPayload>('question:reveal', (r) => {
      setRevealPayload(r)
      setPhase('reveal')
    })

    const offScoreboard = on<{ ranking: RankingEntry[] }>('scoreboard', ({ ranking: r }) => {
      setRanking(r)
    })

    const offPodium = on<{ top: RankingEntry[] }>('podium', ({ top }) => {
      setPodiumTop(top)
      setPhase('podium')
    })

    return () => {
      offLobby()
      offShow()
      offTimer()
      offProgress()
      offReveal()
      offScoreboard()
      offPodium()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bascule auto révélation → classement (voir le commentaire de
  // REVEAL_HOLD_MS) : seulement une fois le VRAI `scoreboard` de cette manche
  // arrivé (jamais sur un `ranking` resté vide depuis le reset ci-dessus).
  useEffect(() => {
    if (phase !== 'reveal' || ranking.length === 0) return
    const t = window.setTimeout(() => setPhase('scoreboard'), REVEAL_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [phase, ranking])

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

  // RGAA 2.4.3 : focus sur le titre propre à la nouvelle phase — jamais au
  // tout premier rendu.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    phaseHeadingRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (phase === 'podium') podiumHeadingRef.current?.focus()
  }, [phase])

  if (joinState === 'error') {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {joinError}
        </p>
        <p style={{ color: 'var(--ink-dim)' }}>
          Générez un nouveau lien depuis le contrôleur hôte (« Grand écran »).
        </p>
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

  const rows =
    phase === 'reveal' && question && revealPayload
      ? buildDistributionRows(question.type, revealPayload.correct, revealPayload.distribution)
      : null
  const maxCount = rows && rows.length > 0 ? Math.max(1, ...rows.map((r) => r.count)) : 1

  function renderLiveAnswers() {
    if (!question) return null
    if (question.type === 'mcq') {
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
        <span>Réponse libre — tapez sur votre mobile</span>
      </div>
    )
  }

  function renderDistribution() {
    if (!rows || rows.length === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>Aucune réponse reçue pour cette question.</p>
    }
    return (
      <div className="big-distribution" style={{ ['--dist-cols' as string]: String(rows.length) }}>
        {rows.map((row) => (
          <div
            className={`big-distribution__col${row.correct ? ' big-distribution__col--correct' : ''}`}
            key={row.key}
          >
            <div className="big-distribution__bar-track">
              <div
                className="big-distribution__bar"
                style={{
                  height: `${(row.count / maxCount) * 100}%`,
                  ['--bar-color' as string]: row.shape ? `var(--ans-${row.shape})` : 'var(--brand-2)',
                }}
              />
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
            <span className="big-distribution__count">{row.count} réponse(s)</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <main className="big-screen" id="contenu-principal" tabIndex={-1}>
      {(phase === 'question' || phase === 'reveal' || phase === 'scoreboard') && (
        <div className="big-join-reminder">
          Rejoignez sur <strong>{window.location.host}</strong>
          {pin && (
            <>
              {' '}
              · PIN <strong>{pin}</strong>
            </>
          )}
        </div>
      )}

      {phase === 'lobby' && (
        <div className="big-lobby">
          <Logo />
          <div>
            <h1 className="ab-hero-title" ref={phaseHeadingRef} tabIndex={-1}>
              {quizTitle}
            </h1>
            <p className="big-lobby__tagline">Le quiz en direct, open-source.</p>
            <p className="big-lobby__proof">
              Rejoignez en 5 secondes, aucune appli à installer. Vos données restent chez vous.
            </p>
          </div>
          {pin ? (
            <PinDisplay pin={pin} />
          ) : (
            <p style={{ color: 'var(--ink-dim)' }}>PIN indisponible — demandez-le à l’hôte.</p>
          )}

          {players.length === 0 ? (
            <p className="big-lobby__empty">En attente des joueurs… Saisissez le PIN pour rejoindre.</p>
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

      {phase === 'question' && question && (
        <div className="big-live">
          <div className="big-live__header">
            <span className="host-badge">Question en cours</span>
            <TimerRing remainingSeconds={remaining ?? question.timeLimit} totalSeconds={question.timeLimit} size={180} large />
          </div>

          <h1 className="big-live__prompt" ref={phaseHeadingRef} tabIndex={-1}>
            {question.prompt}
          </h1>

          {renderLiveAnswers()}

          <p className="big-live__answered">
            {progressAnswered} / {players.length} {progressAnswered <= 1 ? 'a' : 'ont'} répondu
          </p>
        </div>
      )}

      {phase === 'reveal' && question && (
        <div className="big-live">
          <div className="big-live__header">
            <span className="host-badge">Révélation</span>
          </div>

          <h1 className="big-live__prompt" ref={phaseHeadingRef} tabIndex={-1}>
            {question.prompt}
          </h1>

          {renderDistribution()}
        </div>
      )}

      {phase === 'scoreboard' && (
        <div className="big-scoreboard">
          <h1 className="ab-hero-title" ref={phaseHeadingRef} tabIndex={-1}>
            Classement
          </h1>
          {ranking.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)' }}>Le classement s’affichera après la première question.</p>
          ) : (
            <ol className="big-scoreboard__list">
              {ranking.slice(0, 5).map((p, index) => (
                <li key={p.playerId} className="big-scoreboard__row">
                  <span className={`big-scoreboard__rank${index === 0 ? ' big-scoreboard__rank--first' : ''}`}>
                    {index + 1}
                  </span>
                  <span className="big-scoreboard__name">{p.nickname}</span>
                  <span className="big-scoreboard__score">{p.score} pts</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {phase === 'podium' && (
        <PodiumView quizTitle={quizTitle} top={podiumTop} fullRanking={ranking} headingRef={podiumHeadingRef} showConversionFooter />
      )}
    </main>
  )
}
