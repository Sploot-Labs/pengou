import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AnimatedBar, Confetti, CountUp, PhaseTransition, useCue, useFocusOnMount, useSound } from '../motion/index.js'
import { boardEntries } from '../realtime/board'
import { buildDistributionRows, type QuestionKind } from '../realtime/distribution'
import { useGameSocket } from '../realtime/useGameSocket'
import type { RankingEntry, ReadingView, SessionRelaunchedView } from '../realtime/contracts'
import { hardReload } from '../realtime/hardReload'
import { ThemeProvider } from '../theme/ThemeProvider.js'
import { AnswerShape, JoinInvite, Logo, PinDisplay, SoundToggle, TimerRing } from '../ui'
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

/** Projection « lecture seule » émise par `question:reading` (Task 3, moteur
 * `readingView`) — DÉLIBÉRÉMENT sans `id`/`type`/`payload`/options : le grand
 * écran ne doit rien pouvoir afficher qui ressemble à une réponse pendant la
 * lecture (anti-triche, cohérent avec le moteur qui ne les envoie pas). */
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

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])

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

    const offReveal = on<RevealPayload>('question:reveal', (r) => {
      setRevealPayload(r)
      cue('phase.enter:reveal')
      setPhase('reveal')
    })

    const offScoreboard = on<{ ranking: RankingEntry[] }>('scoreboard', ({ ranking: r }) => {
      setRanking(r)
    })

    const offPodium = on<{ top: RankingEntry[] }>('podium', ({ top }) => {
      setPodiumTop(top)
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
  useEffect(() => {
    if (phase !== 'reveal' || ranking.length === 0) return
    const t = window.setTimeout(() => {
      cue('phase.enter:scoreboard')
      setPhase('scoreboard')
    }, REVEAL_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [phase, ranking])

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
        <span>Réponse libre : tapez sur votre mobile</span>
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
            <span className="big-distribution__count">{row.count} réponse(s)</span>
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

      <PhaseTransition phaseKey={phase} className="big-phase-layer">
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
            <>
              <PinDisplay pin={pin} />
              <JoinInvite pin={pin} />
            </>
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

      {phase === 'question' && question && (
        <div className="big-live">
          <div className="big-live__header">
            <span className="host-badge">Question en cours</span>
            <TimerRing remainingSeconds={remaining ?? question.timeLimit} totalSeconds={question.timeLimit} size={180} large />
          </div>

          <h1 className="big-live__prompt" ref={focusPhaseHeading} tabIndex={-1}>
            {question.prompt}
          </h1>

          {renderLiveAnswers()}

          <p className="big-live__answered">
            {progressAnswered} / {players.length} {progressAnswered <= 1 ? 'a' : 'ont'} répondu
          </p>
        </div>
      )}

      {phase === 'reveal' && (
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
              {boardEntries(ranking, players).slice(0, 5).map((p, index) => (
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

      {phase === 'podium' && (
        <div style={{ position: 'relative' }}>
          <Confetti active />
          <PodiumView quizTitle={quizTitle} top={podiumTop} fullRanking={ranking} headingRef={focusPhaseHeading} showConversionFooter />
        </div>
      )}
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
