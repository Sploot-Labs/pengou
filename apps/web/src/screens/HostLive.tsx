import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { buildDistributionRows, type QuestionKind } from '../realtime/distribution'
import { useSharedGameSocket } from '../realtime/GameSocketProvider'
import { Button, Logo, PinDisplay, TimerRing } from '../ui'
import { PodiumView } from './Podium'

/**
 * Contrôleur hôte réel, câblé sur `apps/server/src/game-gateway.ts` via la
 * socket PARTAGÉE (voir `realtime/GameSocketProvider.tsx` — `host:create`,
 * appelé par `HostEditor` sur cette même connexion, est ce qui donne à CETTE
 * socket son autorité « hôte » ; aucune donnée mockée ne reste ici.
 */

/* ------------------------------------------------------------------ */
/* Contrat serveur (types locaux — pas de mock)                        */
/* ------------------------------------------------------------------ */

/** `question:show` — même projection anti-triche que côté joueur : jamais de
 * bonne réponse, y compris pour l'hôte (le serveur ne l'envoie à personne
 * avant `question:reveal`). */
interface QuestionShowPayload {
  id: string
  type: QuestionKind
  prompt: string
  timeLimit: number
  payload: unknown
}

interface TimerPayload {
  timeLimit: number
  startedAt: number | null
}

/** `question:reveal` — voir `packages/game/src/engine.ts`, `questionResult()` :
 * `distribution` est indexée par `JSON.stringify(réponse)`, pas par option —
 * décodée par `buildDistributionRows` (`realtime/distribution.ts`, partagé
 * avec `BigScreen`). */
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

type UiPhase = 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'

function phaseLabel(phase: UiPhase): string {
  switch (phase) {
    case 'lobby':
      return 'Lobby'
    case 'question':
      return 'Question en cours'
    case 'reveal':
      return 'Révélation'
    case 'scoreboard':
      return 'Classement'
    case 'podium':
      return 'Podium'
  }
}

/** Ack de succès `host:createScreenToken` (`apps/server/src/game-gateway.ts`). */
interface ScreenTokenAck {
  displayToken: string
}

/** Le serveur ne transmet ni le PIN ni le titre du quiz à `screen:join` (voir
 * `game-gateway.ts` : l'ack de succès est `{ok: true}`, rien d'autre) — ces
 * deux informations ne sont connues du front qu'au moment de `host:create`
 * (voir `HostEditor.launchGame`, qui les passe à `HostLive` via l'état de
 * navigation). Le lien grand écran les encode donc en query string EN PLUS
 * du token, pour que `BigScreen` puisse les afficher sans dépendre d'un
 * canal que le serveur n'offre pas. */
function buildScreenUrl(sessionId: string, displayToken: string, pin: string | null, quizTitle: string): string {
  const url = new URL(`/screen/${sessionId}`, window.location.origin)
  url.searchParams.set('token', displayToken)
  if (pin) url.searchParams.set('pin', pin)
  if (quizTitle) url.searchParams.set('title', quizTitle)
  return url.toString()
}

/**
 * État de connexion de la socket PARTAGÉE, indépendant de `phase` :
 *  - 'online' : transport connecté, aucune coupure détectée depuis le montage.
 *  - 'reconnecting' : coupure en cours, Socket.IO retente automatiquement.
 *  - 'broken' : le transport a effectivement RECONNECTÉ après une coupure —
 *    mais sans `connectionStateRecovery` côté serveur (aucun configuré, voir
 *    `apps/server/src/realtime.ts`), cette reconnexion crée un NOUVEAU socket
 *    serveur (socket.id/socket.data neufs, room perdue). L'autorité « hôte »
 *    posée par `host:create` (voir `GameSocketProvider.tsx`) est donc perdue
 *    IRRÉVOCABLEMENT pour ce montage : tout `host:*` échouera désormais avec
 *    « action réservée à l'hôte de la session ». Un vrai correctif demande un
 *    changement serveur (recovery, ou un `host:reconnect` — suivi Plan 7) ;
 *    côté front, le mieux qu'on puisse faire est de le détecter et de guider
 *    l'hôte vers la seule issue possible : relancer depuis l'éditeur.
 */
type ConnectionState = 'online' | 'reconnecting' | 'broken'

const HOST_AUTHORITY_LOST_MESSAGE =
  'La connexion a été interrompue puis rétablie, mais cette partie ne peut plus être pilotée depuis cet onglet (le serveur ne permet pas de reprendre l’autorité hôte après une coupure). Retournez à l’éditeur et relancez la partie.'

/** Traduit une erreur serveur brute en message actionnable. La string exacte
 * « action réservée à l'hôte de la session » (`requireHost`, game-gateway.ts)
 * ne dit à l'hôte ni CE QUI s'est passé ni QUOI FAIRE — si elle survient
 * alors qu'on sait la connexion compromise (`connection === 'broken'`), ou
 * même si on ne le savait pas encore (course reconnect/clic), on la remplace
 * par une consigne claire plutôt que de l'afficher telle quelle. */
function friendlyActionError(err: unknown, connection: ConnectionState): string {
  if (connection === 'broken') return HOST_AUTHORITY_LOST_MESSAGE
  const message = err instanceof Error ? err.message : null
  if (message === "action réservée à l'hôte de la session") return HOST_AUTHORITY_LOST_MESSAGE
  return message ?? 'Une erreur est survenue.'
}

export function HostLive() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { emitAck, on, socket } = useSharedGameSocket()

  const [connection, setConnection] = useState<ConnectionState>('online')

  // Transmis par HostEditor au moment de la navigation (`host:create` ne
  // redonne le PIN/titre qu'à CE moment précis ; aucun événement ultérieur
  // ne les renvoie). Absents si cet écran est atteint autrement (ex.
  // rechargement complet de page) — dégradé gracieusement, jamais fabriqué.
  const navState = location.state as { pin?: string; quizTitle?: string } | null
  const [pin] = useState<string | null>(navState?.pin ?? null)
  const quizTitle = navState?.quizTitle ?? 'Partie en direct'

  const [phase, setPhase] = useState<UiPhase>('lobby')
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [lobbyAnnouncement, setLobbyAnnouncement] = useState('')

  const [question, setQuestion] = useState<QuestionShowPayload | null>(null)
  const [timer, setTimer] = useState<TimerPayload | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [progressAnswered, setProgressAnswered] = useState(0)
  const [respondedAnnouncement, setRespondedAnnouncement] = useState('')

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])

  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // `host:skip` déclenche EXACTEMENT le même reveal+scoreboard serveur que
  // `host:reveal` (voir doReveal côté passerelle) — la seule différence
  // voulue est visuelle : « Passer » ne doit jamais montrer l'écran de
  // révélation, contrairement au bouton « Révéler ». Ce ref laisse le
  // handler `question:reveal` NE PAS avancer la phase locale quand un skip
  // est en cours ; c'est `scoreboard` qui avance alors directement.
  const skipRequestedRef = useRef(false)

  const [screenPending, setScreenPending] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [screenUrl, setScreenUrl] = useState<string | null>(null)
  const [screenCopyStatus, setScreenCopyStatus] = useState<string | null>(null)

  const phaseHeadingRef = useRef<HTMLHeadingElement>(null)
  const podiumHeadingRef = useRef<HTMLHeadingElement>(null)
  const isFirstRender = useRef(true)

  // RGAA 2.4.3 : focus sur le titre propre à la nouvelle phase — jamais au
  // tout premier rendu.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    phaseHeadingRef.current?.focus()
  }, [phase])

  /* ---------------------------------------------------------------- */
  /* Abonnements — un seul montage                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    // `hasConnectedOnce` distingue la toute première connexion (rien à
    // signaler) d'une VRAIE reconnexion (voir le commentaire de
    // `ConnectionState` ci-dessus) — même garde que PlayerLive.tsx pour le
    // même besoin. Capturé dans une closure (pas un ref) : cet effet ne
    // monte qu'une fois, donc pas de risque de valeur périmée entre rendus.
    let hasConnectedOnce = socket.connected
    const offConnect = on('connect', () => {
      if (hasConnectedOnce) {
        // Reconnexion effective : l'autorité hôte est perdue pour de bon
        // (voir ConnectionState) — signalé IMMÉDIATEMENT, sans attendre
        // qu'un clic échoue, contrairement au comportement précédent.
        setConnection('broken')
      } else {
        hasConnectedOnce = true
      }
    })
    const offDisconnect = on('disconnect', () => {
      setConnection((prev) => (prev === 'broken' ? 'broken' : 'reconnecting'))
    })

    const offLobby = on<{ players: LobbyPlayer[] }>('lobby:update', ({ players: list }) => {
      setPlayers(list)
    })

    const offShow = on<QuestionShowPayload>('question:show', (view) => {
      setQuestion(view)
      setTimer(null)
      setRemaining(null)
      setRevealPayload(null)
      setProgressAnswered(0)
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
      if (!skipRequestedRef.current) setPhase('reveal')
    })

    const offScoreboard = on<{ ranking: RankingEntry[] }>('scoreboard', ({ ranking: r }) => {
      setRanking(r)
      if (skipRequestedRef.current) {
        skipRequestedRef.current = false
        setPhase('scoreboard')
      }
    })

    const offPodium = on<{ top: RankingEntry[] }>('podium', ({ top }) => {
      setPodiumTop(top)
      setPhase('podium')
    })

    return () => {
      offConnect()
      offDisconnect()
      offLobby()
      offShow()
      offTimer()
      offProgress()
      offReveal()
      offScoreboard()
      offPodium()
    }
    // Un seul montage : `on` est stable pour la durée de vie de la socket
    // partagée (voir useGameSocket.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------------- */
  /* Chrono — dérivé de `startedAt` serveur, comme PlayerLive            */
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

  // Annonce debouncée de l'arrivée des joueurs (lobby uniquement) — pas une
  // annonce par joueur.
  useEffect(() => {
    if (phase !== 'lobby') return
    const t = window.setTimeout(() => {
      const verb = players.length > 1 ? 'ont' : 'a'
      setLobbyAnnouncement(
        players.length === 0
          ? ''
          : `${players.length} joueur${players.length > 1 ? 's' : ''} ${verb} rejoint la partie.`,
      )
    }, 600)
    return () => window.clearTimeout(t)
  }, [phase, players])

  // Annonce debouncée du compteur de réponses (question uniquement).
  useEffect(() => {
    if (phase !== 'question') return
    const t = window.setTimeout(() => {
      setRespondedAnnouncement(
        `${progressAnswered} sur ${players.length} ${progressAnswered > 1 ? 'ont' : 'a'} répondu.`,
      )
    }, 700)
    return () => window.clearTimeout(t)
  }, [phase, progressAnswered, players.length])

  useEffect(() => {
    if (phase === 'podium') podiumHeadingRef.current?.focus()
  }, [phase])

  if (!sessionId) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          Identifiant de session manquant dans l’URL.
        </p>
      </main>
    )
  }

  /* ---------------------------------------------------------------- */
  /* Actions hôte                                                       */
  /* ---------------------------------------------------------------- */

  async function runHostAction(event: string): Promise<void> {
    setActionPending(true)
    setActionError(null)
    // Autorité déjà connue perdue (voir ConnectionState) : inutile d'attendre
    // un aller-retour réseau qui échouera à coup sûr — message actionnable
    // immédiat plutôt qu'un délai suivi de la même conclusion.
    if (connection === 'broken') {
      setActionError(HOST_AUTHORITY_LOST_MESSAGE)
      setActionPending(false)
      return
    }
    try {
      await emitAck(event, {})
    } catch (err) {
      setActionError(friendlyActionError(err, connection))
    } finally {
      setActionPending(false)
    }
  }

  function startGame() {
    void runHostAction('host:start')
  }

  function revealAnswer() {
    void runHostAction('host:reveal')
  }

  /** N'utilise PAS `runHostAction` : en cas d'échec, `skipRequestedRef` doit
   * être réarmé à `false` explicitement (sinon un `host:reveal` normal sur
   * une question ultérieure resterait bloqué en phase 'question' — le flag
   * empêcherait à tort le handler `question:reveal` d'avancer la phase). Le
   * flag n'est nettoyé sur le chemin de SUCCÈS que par le handler
   * `scoreboard` (voir l'abonnement plus haut), au moment où le classement
   * réellement arrivé du serveur permet d'avancer directement dessus. */
  function skipQuestion() {
    skipRequestedRef.current = true
    setActionPending(true)
    setActionError(null)
    if (connection === 'broken') {
      skipRequestedRef.current = false
      setActionError(HOST_AUTHORITY_LOST_MESSAGE)
      setActionPending(false)
      return
    }
    emitAck('host:skip', {})
      .catch((err) => {
        skipRequestedRef.current = false
        setActionError(friendlyActionError(err, connection))
      })
      .finally(() => setActionPending(false))
  }

  function goToScoreboard() {
    // Transition purement locale : `scoreboard` (le classement) est déjà
    // arrivé en même temps que `question:reveal` pour ce même `host:reveal`
    // (voir doReveal côté passerelle) — aucun nouvel appel réseau requis.
    setPhase('scoreboard')
  }

  function advance() {
    void runHostAction('host:next')
  }

  async function createScreenLink() {
    if (!sessionId) return
    setScreenPending(true)
    setScreenError(null)
    setScreenCopyStatus(null)
    if (connection === 'broken') {
      setScreenError(HOST_AUTHORITY_LOST_MESSAGE)
      setScreenPending(false)
      return
    }
    try {
      const ack = await emitAck<ScreenTokenAck>('host:createScreenToken', {})
      setScreenUrl(buildScreenUrl(sessionId, ack.displayToken, pin, quizTitle))
    } catch (err) {
      setScreenError(friendlyActionError(err, connection))
    } finally {
      setScreenPending(false)
    }
  }

  async function copyScreenLink() {
    if (!screenUrl) return
    try {
      await navigator.clipboard.writeText(screenUrl)
      setScreenCopyStatus('Lien copié.')
    } catch {
      setScreenCopyStatus('Copie impossible — sélectionnez et copiez le lien manuellement.')
    }
  }

  /* ---------------------------------------------------------------- */

  const connectedCount = players.filter((p) => p.connected).length
  const canLaunch = players.length > 0
  const rows =
    phase === 'reveal' && question && revealPayload
      ? buildDistributionRows(question.type, revealPayload.correct, revealPayload.distribution)
      : null
  const maxRowCount = rows && rows.length > 0 ? Math.max(1, ...rows.map((r) => r.count)) : 1
  const revealedAnswerText = rows ? (rows.find((r) => r.correct)?.label ?? '') : ''

  function renderDistribution() {
    if (!rows) return null
    if (rows.length === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>Aucune réponse reçue pour cette question.</p>
    }
    return (
      <ul className="hostlive-answers" aria-label="Réponses et distribution">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`hostlive-answer-row${row.correct ? ' hostlive-answer-row--correct' : ''}`}
          >
            <span className="hostlive-answer-row__label">
              {row.label}
              {row.correct && (
                <span className="hostlive-answer-row__correct-tag">
                  <span aria-hidden="true">✓</span> Bonne réponse
                </span>
              )}
            </span>
            <span className="hostlive-answer-row__bar-track">
              <span
                className="hostlive-answer-row__bar"
                style={{
                  width: `${(row.count / maxRowCount) * 100}%`,
                  ['--bar-color' as string]: row.shape ? `var(--ans-${row.shape})` : 'var(--brand-2)',
                }}
              />
            </span>
            <span className="hostlive-answer-row__count">{row.count}</span>
          </li>
        ))}
      </ul>
    )
  }

  function renderLeaderboard(limit: number, focusTarget: boolean) {
    const top = ranking.slice(0, limit)
    if (top.length === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>Le classement s’affichera après la première question.</p>
    }
    return (
      <>
        {focusTarget ? (
          <h2 ref={phaseHeadingRef} tabIndex={-1}>
            Classement
          </h2>
        ) : (
          <h2>Top joueurs</h2>
        )}
        <ol className="hostlive-board">
          {top.map((p, index) => (
            <li key={p.playerId} className="hostlive-board__row">
              <span className={`hostlive-board__rank${index === 0 ? ' hostlive-board__rank--first' : ''}`}>
                {index + 1}
              </span>
              <span className="hostlive-board__name">{p.nickname}</span>
              <span className="hostlive-board__score">{p.score} pts</span>
            </li>
          ))}
        </ol>
      </>
    )
  }

  return (
    <div className="ab-shell hostlive-shell">
      <header className="ab-shell__header hostlive-header">
        <Logo compact />
        <div className="hostlive-header__meta">
          <div style={{ minWidth: 0 }}>
            <span className="hostlive-header__title">{quizTitle}</span>
            <p className="host-brandline">Arena — open-source · chez vous ou dans le cloud</p>
          </div>
          {pin ? (
            <PinDisplay pin={pin} compact label="Code PIN de la partie" />
          ) : (
            <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
              PIN indisponible (session atteinte sans passer par « Lancer la partie »).
            </p>
          )}
        </div>
        <div className="hostlive-header__status">
          <span className="host-badge">
            {players.length} joueur{players.length > 1 ? 's' : ''}
            {phase !== 'lobby' && players.length > 0 ? ` (${connectedCount} connecté${connectedCount > 1 ? 's' : ''})` : ''}
          </span>
          <span className="host-badge">{phaseLabel(phase)}</span>
        </div>
      </header>

      {connection === 'reconnecting' && (
        <p className="player-net player-net--reconnecting" role="alert">
          Connexion perdue — reconnexion…
        </p>
      )}
      {connection === 'broken' && (
        <p
          className="player-net player-net--reconnecting"
          role="alert"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)' }}
        >
          <span>{HOST_AUTHORITY_LOST_MESSAGE}</span>
          <Button variant="ghost" type="button" onClick={() => navigate('/')}>
            Retour à l’éditeur
          </Button>
        </p>
      )}

      {/* Passerelle grand écran : lien à usage unique généré à la demande —
          voir buildScreenUrl ci-dessus pour pourquoi le PIN y est encodé. */}
      <div className="host-field" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button variant="ghost" type="button" disabled={screenPending} onClick={() => void createScreenLink()}>
            {screenPending ? 'Génération…' : screenUrl ? 'Régénérer le lien grand écran' : 'Grand écran'}
          </Button>
          {screenUrl && (
            <>
              <label htmlFor="hostlive-screen-url" className="visually-hidden">
                Lien du grand écran
              </label>
              <input
                id="hostlive-screen-url"
                type="text"
                readOnly
                value={screenUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: '1 1 320px', minWidth: 0, fontFamily: 'var(--font-mono)' }}
              />
              <Button variant="ghost" type="button" onClick={() => void copyScreenLink()}>
                Copier
              </Button>
            </>
          )}
        </div>
        {screenError && (
          <p className="join-error" role="alert">
            {screenError}
          </p>
        )}
        {screenCopyStatus && (
          <p role="status" aria-live="polite" style={{ color: 'var(--ink-dim)' }}>
            {screenCopyStatus}
          </p>
        )}
        {screenUrl && (
          <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
            À usage unique : ouvrez ce lien sur le projecteur AVANT de lancer la partie ; il devient invalide une
            fois utilisé.
          </p>
        )}
      </div>

      <main className="ab-shell__main hostlive-main" id="contenu-principal" tabIndex={-1}>
        <h1 className="visually-hidden">Contrôleur hôte live</h1>

        {actionError && (
          <p className="join-error" role="alert">
            {actionError}
          </p>
        )}

        <div className="hostlive-layout">
          <section className="hostlive-primary" aria-label="Pilotage de la partie">
            {phase === 'lobby' && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  En attente des joueurs
                </h2>
                <p style={{ color: 'var(--ink-dim)' }}>
                  Partagez le PIN sur le grand écran, ou le lien ci-dessus.
                </p>

                {players.length === 0 ? (
                  <p className="hostlive-empty">
                    Aucun joueur pour l’instant. La partie se lance dès qu’un joueur rejoint.
                  </p>
                ) : (
                  <ul className="hostlive-players" aria-label="Joueurs ayant rejoint la partie">
                    {players.map((p) => (
                      <li key={p.id} className="hostlive-players__chip">
                        {p.nickname}
                        {!p.connected && <span className="visually-hidden"> (hors ligne)</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <p role="status" aria-live="polite">
                  {lobbyAnnouncement}
                </p>

                <div className="hostlive-controls">
                  <Button
                    variant="primary"
                    type="button"
                    aria-disabled={!canLaunch || actionPending}
                    aria-describedby={!canLaunch ? 'hostlive-launch-reason' : undefined}
                    onClick={(e) => {
                      if (!canLaunch || actionPending) {
                        e.preventDefault()
                        return
                      }
                      startGame()
                    }}
                  >
                    {actionPending ? 'Lancement…' : 'Lancer la partie'}
                  </Button>
                  {!canLaunch && (
                    <p className="hostlive-controls__hint" id="hostlive-launch-reason">
                      En attente d’au moins un joueur pour lancer la partie.
                    </p>
                  )}
                </div>
              </div>
            )}

            {phase === 'question' && question && (
              <div className="hostlive-phase">
                <div className="hostlive-phase__header">
                  <h2 ref={phaseHeadingRef} tabIndex={-1}>
                    {question.prompt}
                  </h2>
                  <TimerRing remainingSeconds={remaining ?? question.timeLimit} totalSeconds={question.timeLimit} size={72} />
                </div>

                <p className="hostlive-progress" aria-hidden="true">
                  {progressAnswered} / {players.length} {progressAnswered > 1 ? 'ont' : 'a'} répondu
                </p>
                <p className="visually-hidden" role="status" aria-live="polite">
                  {respondedAnnouncement}
                </p>

                <div className="hostlive-controls">
                  <Button variant="primary" type="button" disabled={actionPending} onClick={revealAnswer}>
                    Révéler la réponse
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={actionPending}
                    onClick={() => {
                      // Honnêteté : `host:skip` est un ALIAS serveur de `host:reveal` (voir
                      // `doReveal`, game-gateway.ts) — il diffuse `question:reveal` à TOUTE la
                      // room comme un reveal normal ; seul `skipRequestedRef` (ci-dessus) empêche
                      // CET écran hôte de basculer sur la vue révélation. Les joueurs et le grand
                      // écran, eux, voient la réponse. Un vrai skip serveur (sans révélation pour
                      // personne) est un suivi Plan 7 — ce libellé ne doit jamais prétendre le
                      // contraire.
                      if (
                        window.confirm(
                          'Révéler la réponse et passer directement au classement ? La réponse sera affichée aux joueurs et au grand écran.',
                        )
                      ) {
                        skipQuestion()
                      }
                    }}
                  >
                    Passer
                  </Button>
                </div>
              </div>
            )}

            {phase === 'reveal' && question && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  Révélation — {question.prompt}
                </h2>
                <p className="visually-hidden" role="status" aria-live="polite">
                  Réponse révélée : {revealedAnswerText}
                </p>

                {renderDistribution()}

                <div className="hostlive-controls">
                  <Button variant="primary" type="button" onClick={goToScoreboard}>
                    Afficher le classement
                  </Button>
                </div>
              </div>
            )}

            {phase === 'scoreboard' && (
              <div className="hostlive-phase">
                {renderLeaderboard(8, true)}
                <div className="hostlive-controls">
                  {/* Libellé volontairement neutre : `question:show` ne porte
                      ni index ni total de questions (voir PlayerLive), donc
                      rien ne permet de savoir CÔTÉ CLIENT si cette manche est
                      la dernière avant de cliquer — le serveur tranche
                      (nouvelle question ou `podium`), les deux sont gérés par
                      les mêmes abonnements `question:show`/`podium`. */}
                  <Button variant="primary" type="button" disabled={actionPending} onClick={advance}>
                    {actionPending ? '…' : 'Suivant'}
                  </Button>
                </div>
              </div>
            )}

            {phase === 'podium' && (
              <PodiumView quizTitle={quizTitle} top={podiumTop} fullRanking={ranking} headingRef={podiumHeadingRef} />
            )}
          </section>

          {(phase === 'question' || phase === 'reveal') && (
            <aside className="hostlive-aside" aria-label="Dernier classement connu">
              {renderLeaderboard(5, false)}
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}
