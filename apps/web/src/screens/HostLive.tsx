import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { isScoredType, pollPercent } from '@splootlabs/quiz'
import { buildDistributionRows, pollRows, type QuestionKind } from '../realtime/distribution'
import {
  NOT_HOST_ACK_CODE,
  type PodiumPayload,
  type PollView,
  type RankingEntry,
  type ReadingView,
  type WordcloudView,
} from '../realtime/contracts'
import { hasAckCode } from '../realtime/ackError'
import { WordCloud, wordcloudSummary } from '../ui/WordCloud'
import { QuestionImage } from '../ui/QuestionImage'
import { listQuizzes, type QuizListItem } from '../api/quizzes'
import { boardEntries } from '../realtime/board'
import { hardReload } from '../realtime/hardReload'
import { useSharedGameSocket } from '../realtime/GameSocketProvider'
import { Button, Logo, PinDisplay, TimerRing } from '../ui'
import { useT } from '../i18n/useT'
import { formatNumber as formatNumberNow, t, tp as tpNow } from '../i18n/t'
import { getLang } from '../i18n/lang'
import { ClosingView, PodiumView } from './Podium'
import { GuestSignupOffer } from '../ui/GuestSignupOffer'
import { PAGE_LOAD_ID } from '../realtime/pageLoad'

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
  media?: string | null
  mediaAlt?: string | null
}

/** Projection « lecture seule » émise par `question:reading` (Task 3, moteur
 * `readingView`) — même forme que celle consommée par `BigScreen`/`PlayerLive`
 * (voir leurs commentaires) : DÉLIBÉRÉMENT sans options ni bonne réponse, y
 * compris pour l'hôte (anti-triche, le moteur ne les envoie pas avant
 * `question:show`). Émise aussi par `emitReconnectSnapshot` (game-gateway.ts)
 * pour un hôte qui reprend en pleine lecture — voir l'abonnement `host:reconnect`
 * ci-dessous, qui n'a rien à faire de plus : cette même souscription
 * `question:reading` reçoit ce cas comme n'importe quel autre. */

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
  /** Présent pour un sondage seulement : sa répartition (pas de bonne réponse). */
  poll?: PollView
}

interface LobbyPlayer {
  id: string
  nickname: string
  score: number
  connected: boolean
}

type UiPhase = 'lobby' | 'reading' | 'question' | 'reveal' | 'scoreboard' | 'podium'

function phaseLabel(phase: UiPhase): string {
  switch (phase) {
    case 'lobby':
      return t('Lobby')
    case 'reading':
      return t('Lecture en cours')
    case 'question':
      return t('Question en cours')
    case 'reveal':
      return t('Révélation')
    case 'scoreboard':
      return t('Classement')
    case 'podium':
      return t('Podium')
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
  // Le projecteur s'ouvre dans la langue courante de l'hôte ; `lang.ts` consomme puis retire le
  // paramètre, le grand écran garde ensuite sa propre langue.
  url.searchParams.set('lang', getLang())
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
 *    pour ce montage : tout `host:*` échouerait désormais avec « action
 *    réservée à l'hôte de la session ». Le serveur EXPOSE bien `host:reconnect`
 *    (Task 8, `game-gateway.ts`, avec snapshot d'état) — c'est d'ailleurs ce
 *    que cet écran appelle AU MONTAGE quand `navState?.pin` est absent (voir
 *    l'effet d'abonnement ci-dessous) — mais on ne le redéclenche PAS
 *    automatiquement ICI, en pleine session déjà rendue à l'écran : re-pousser
 *    un snapshot en douce PENDANT que l'hôte pilote activement la partie
 *    (état local déjà affiché, action potentiellement en cours) risquerait de
 *    lui substituer un état sous les pieds sans qu'il l'ait demandé. Le plus
 *    sûr, pour CE cas précis (coupure en pleine session déjà montée), reste
 *    de guider l'hôte vers l'éditeur puis de relancer/reprendre la partie
 *    explicitement (ce qui remonte cet écran et redéclenche `host:reconnect`
 *    proprement) plutôt que de le faire taire dans son dos.
 */
type ConnectionState = 'online' | 'reconnecting' | 'broken'

/** Fonction et non constante : le texte suit la langue courante à chaque lecture. */
function hostAuthorityLostMessage(): string {
  return t(
    "La connexion a été interrompue puis rétablie, mais cette partie ne peut plus être pilotée depuis cet onglet (le serveur ne permet pas de reprendre l'autorité hôte après une coupure). Retournez à l'éditeur et relancez la partie.",
  )
}

/** Traduit une erreur serveur brute en message actionnable. Le refus
 * « action réservée à l'hôte de la session » (`requireHost`, game-gateway.ts,
 * reconnu à son code `NOT_HOST` : le message arrive dans la langue de la socket)
 * ne dit à l'hôte ni CE QUI s'est passé ni QUOI FAIRE — s'il survient
 * alors qu'on sait la connexion compromise (`connection === 'broken'`), ou
 * même si on ne le savait pas encore (course reconnect/clic), on la remplace
 * par une consigne claire plutôt que de l'afficher telle quelle. */
function friendlyActionError(err: unknown, connection: ConnectionState): string {
  if (connection === 'broken') return hostAuthorityLostMessage()
  if (hasAckCode(err, NOT_HOST_ACK_CODE)) return hostAuthorityLostMessage()
  return err instanceof Error ? err.message : t('Une erreur est survenue.')
}

export function HostLive() {
  // Abonne l'écran à la langue : les textes calculés plus bas (helpers hors composant compris) suivent.
  const { tp, formatNumber } = useT()
  const { sessionId } = useParams<{ sessionId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { emitAck, on, socket } = useSharedGameSocket()

  const [connection, setConnection] = useState<ConnectionState>('online')

  // Transmis par HostEditor au moment de la navigation (`host:create` ne
  // redonne le PIN/titre qu'à CE moment précis ; aucun événement ultérieur
  // ne les renvoie). Absents si cet écran est atteint autrement (reprise
  // depuis Home, ou rechargement complet de page) — dans ce cas, `pin` est
  // reconstitué par `host:reconnect` (voir l'effet de montage plus bas) ;
  // `quizTitle`, lui, RESTE dégradé gracieusement (le serveur ne le renvoie
  // jamais, ni à host:create ni à host:reconnect), jamais fabriqué.
  const navState = location.state as { pin?: string; quizTitle?: string; launch?: string } | null
  const [pin, setPin] = useState<string | null>(navState?.pin ?? null)
  // L'état de navigation survit à un rechargement de page (il vit dans l'historique du navigateur),
  // pas l'autorité d'hôte, liée à la socket. Il ne prouve donc « partie lancée sur cette socket »
  // que s'il a été posé pendant CE chargement de page. Sinon, l'écran demande la reprise.
  const launchedHere = Boolean(navState?.pin) && navState?.launch === PAGE_LOAD_ID
  // Titre brut (peut être absent) pour le lien du grand écran : le repli traduit n'est posé qu'à l'affichage,
  // dans la langue de celui qui regarde, jamais celle de l'hôte dans l'URL du projecteur.
  const rawQuizTitle = navState?.quizTitle ?? ''
  const quizTitle = navState?.quizTitle ?? t('Partie en direct')

  // Reprise (Task 8) : `true` tant que `host:reconnect` n'a pas répondu, UNIQUEMENT quand cet
  // écran est atteint SANS `navState?.pin` (reprise depuis Home, ou rechargement de page) — un
  // lancement direct (`navState?.pin` présent, `host:create` déjà passé sur cette même socket)
  // n'a rien à reprendre et démarre directement en 'lobby'.
  const [resuming, setResuming] = useState(!launchedHere)
  const [resumeError, setResumeError] = useState<string | null>(null)

  const [phase, setPhase] = useState<UiPhase>('lobby')
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [lobbyAnnouncement, setLobbyAnnouncement] = useState('')

  const [reading, setReading] = useState<ReadingView | null>(null)
  const [readingRemaining, setReadingRemaining] = useState<number | null>(null)
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null)
  const [timer, setTimer] = useState<TimerPayload | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [progressAnswered, setProgressAnswered] = useState(0)
  const [respondedAnnouncement, setRespondedAnnouncement] = useState('')
  const [wordcloud, setWordcloud] = useState<WordcloudView | null>(null)

  const [revealPayload, setRevealPayload] = useState<RevealPayload | null>(null)
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [podiumTop, setPodiumTop] = useState<RankingEntry[]>([])
  const [hasScoredQuestions, setHasScoredQuestions] = useState(true)

  // Enchaînement automatique des étapes (demande produit) : l'hôte bascule le mode, le serveur
  // planifie l'avance vers la question suivante après une pause sur le classement. Activé par
  // défaut (côté serveur aussi — voir `host:create`/`DEFAULT_AUTO_ADVANCE`, game-gateway.ts), donc
  // cet état local démarre à `true` sans aller-retour. `autoNextAt` : horodatage serveur de la
  // prochaine bascule (diffusé par `auto:advance`), `null` hors étape classement ou mode désactivé.
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [autoNextAt, setAutoNextAt] = useState<number | null>(null)
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null)

  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [kickPendingId, setKickPendingId] = useState<string | null>(null)
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
  const [relaunchQuizzes, setRelaunchQuizzes] = useState<QuizListItem[] | null>(null)
  const [relaunchQuizId, setRelaunchQuizId] = useState('')
  const [relaunchLoadError, setRelaunchLoadError] = useState<string | null>(null)
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
      setAutoNextAt(null)
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
      // Un skip ne survit jamais à la question qu'il visait.
      skipRequestedRef.current = false
      // Effacé seulement si la question change (rejeu de `question:show` à la reconnexion).
      setWordcloud((prev) => (prev && prev.questionId === view.id ? prev : null))
      setAutoNextAt(null)
      setPhase('question')
    })

    const offWordcloud = on<WordcloudView>('wordcloud:update', (v) => {
      setWordcloud(v)
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

    const offPodium = on<PodiumPayload>('podium', ({ top, ranking: full, hasScoredQuestions: scored }) => {
      setPodiumTop(top)
      if (full) setRanking(full)
      setHasScoredQuestions(scored !== false)
      setAutoNextAt(null)
      setPhase('podium')
    })

    // Enchaînement automatique : le serveur diffuse l'horodatage de la prochaine bascule (ou
    // `null` quand l'hôte coupe le mode) — on ne fait que le refléter, jamais un minuteur local
    // indépendant (même discipline que le chrono de question).
    const offAuto = on<{ nextAt: number | null }>('auto:advance', ({ nextAt }) => {
      setAutoNextAt(nextAt)
    })

    // Reprise (Task 8) : émis en DERNIER dans CE MÊME effet — tous les `on(...)` ci-dessus sont
    // donc déjà enregistrés, de façon SYNCHRONE, avant ce `host:reconnect` asynchrone. Le serveur
    // pousse son snapshot (`lobby:update`/`question:show`+`timer`/`question:reveal`+`scoreboard`/
    // `podium`, voir `emitReconnectSnapshot`, game-gateway.ts) AVANT de répondre à l'ack — ces
    // abonnements ne peuvent donc jamais rater le snapshot. `sessionId` ici est celui de l'URL —
    // l'id moteur (rechargement de `/host/:sessionId` déjà lancé) OU l'id `game_session` persisté
    // (reprise d'une partie live depuis `Home`, seul id qu'elle connaît) — la passerelle accepte
    // les deux (voir sa doc). `phase`, contrairement à `players`/`question`/`ranking`/`podiumTop`
    // (peuplés par les événements ci-dessus), est posé directement depuis l'ack : c'est le SEUL
    // moyen fiable de savoir qu'une session déjà en 'scoreboard' l'est vraiment (le seul
    // événement de snapshot pour cette phase, `scoreboard`, ne fait volontairement PAS avancer
    // `phase` en dehors d'un skip — voir son handler ci-dessus).
    let cancelled = false
    if (!launchedHere && sessionId) {
      emitAck<{ sessionId?: string; pin?: string; phase?: UiPhase; autoAdvance?: boolean }>('host:reconnect', {
        sessionId,
      })
        .then((res) => {
          if (cancelled) return
          if (res.pin) setPin(res.pin)
          if (res.phase) setPhase(res.phase)
          if (typeof res.autoAdvance === 'boolean') setAutoAdvance(res.autoAdvance)
          setResuming(false)
        })
        .catch((err) => {
          if (cancelled) return
          setResuming(false)
          setResumeError(
            err instanceof Error
              ? err.message
              : t(
                  "Impossible de reprendre cette partie : session introuvable, terminée, ou vous n'en êtes pas l'hôte.",
                ),
          )
        })
    }

    return () => {
      cancelled = true
      offConnect()
      offDisconnect()
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
    // Un seul montage : `on` est stable pour la durée de vie de la socket
    // partagée (voir useGameSocket.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------------- */
  /* Décompte de lecture — même dérivation que BigScreen : `startedAt` +   */
  /* durée serveur, jamais un minuteur local indépendant (c'est le serveur */
  /* qui planifie la bascule vers `question:show`, ce décompte ne fait que */
  /* la REFLÉTER). Valeur toujours rendue en texte (RGAA).                */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /* Compte à rebours inter-étapes (enchaînement automatique) — dérivé */
  /* de l'horodatage serveur `autoNextAt`, jamais un minuteur local    */
  /* indépendant (c'est le serveur qui planifie la bascule).           */
  /* ---------------------------------------------------------------- */

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

  // Annonce debouncée de l'arrivée des joueurs (lobby uniquement) — pas une
  // annonce par joueur.
  useEffect(() => {
    if (phase !== 'lobby') return
    const timeout = window.setTimeout(() => {
      setLobbyAnnouncement(
        players.length === 0
          ? ''
          : tpNow(players.length, '{n} joueur a rejoint la partie.', '{n} joueurs ont rejoint la partie.'),
      )
    }, 600)
    return () => window.clearTimeout(timeout)
  }, [phase, players])

  // Annonce debouncée du compteur de réponses (question uniquement).
  useEffect(() => {
    if (phase !== 'question') return
    const timeout = window.setTimeout(() => {
      setRespondedAnnouncement(
        tpNow(progressAnswered, '{n} sur {total} a répondu.', '{n} sur {total} ont répondu.', {
          total: formatNumberNow(players.length),
        }),
      )
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [phase, progressAnswered, players.length])

  useEffect(() => {
    if (phase === 'podium') podiumHeadingRef.current?.focus()
  }, [phase])

  // Relance depuis le podium : liste des quiz de l'hôte, chargée une seule fois à l'arrivée au podium.
  useEffect(() => {
    if (phase !== 'podium' || relaunchQuizzes !== null) return
    let cancelled = false
    listQuizzes()
      .then((list) => {
        if (cancelled) return
        setRelaunchQuizzes(list)
        setRelaunchQuizId((current) => current || list[0]?.id || '')
      })
      .catch(() => {
        if (!cancelled) setRelaunchLoadError(t('Impossible de charger vos quiz.'))
      })
    return () => {
      cancelled = true
    }
  }, [phase, relaunchQuizzes])

  async function relaunch(): Promise<void> {
    if (!relaunchQuizId) return
    setActionPending(true)
    setActionError(null)
    try {
      const ack = await emitAck<{ sessionId: string; pin: string }>('host:relaunch', { quizId: relaunchQuizId })
      // Rechargement complet : HostLive se remonte sur la nouvelle session et reprend via host:reconnect.
      hardReload('/host/' + ack.sessionId)
    } catch (err) {
      setActionError(friendlyActionError(err, connection))
      setActionPending(false)
    }
  }

  // Exclusion d'un joueur : pas de retrait optimiste, la liste suit le `lobby:update` du serveur.
  async function kickPlayer(playerId: string, nickname: string): Promise<void> {
    if (!window.confirm(t('Exclure {nickname} de la partie ?', { nickname }))) return
    setKickPendingId(playerId)
    setActionError(null)
    try {
      await emitAck('host:kick', { playerId })
    } catch (err) {
      setActionError(friendlyActionError(err, connection))
    } finally {
      setKickPendingId(null)
    }
  }

  if (!sessionId) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {t("Identifiant de session manquant dans l'URL.")}
        </p>
      </main>
    )
  }

  // Reprise (Task 8) en échec : session terminée/introuvable, ou cet utilisateur n'est pas
  // l'hôte de cette session (voir `host:reconnect`, game-gateway.ts). Aucun état de jeu n'a été
  // reçu (les abonnements n'ont livré aucun snapshot) — un message clair plutôt qu'un lobby vide
  // fabriqué qui laisserait croire à tort qu'il suffit d'attendre des joueurs.
  if (resumeError) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {resumeError}
        </p>
        <Button variant="primary" type="button" onClick={() => navigate('/')}>
          {t("Retour à l'accueil")}
        </Button>
      </main>
    )
  }

  // Reprise (Task 8) en cours : `host:reconnect` n'a pas encore répondu — tant qu'on ne sait pas
  // si cette reprise va réussir (et avec quelle phase), rien n'est rendu à part ce statut : pas
  // de lobby vide ni de phase par défaut qui laisserait croire à un état réel avant confirmation.
  if (resuming) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">{t('Reprise de la partie…')}</p>
      </main>
    )
  }

  /* ---------------------------------------------------------------- */
  /* Actions hôte                                                       */
  /* ---------------------------------------------------------------- */

  async function runHostAction(event: string, payload: unknown = {}): Promise<void> {
    setActionPending(true)
    setActionError(null)
    // Autorité déjà connue perdue (voir ConnectionState) : inutile d'attendre
    // un aller-retour réseau qui échouera à coup sûr — message actionnable
    // immédiat plutôt qu'un délai suivi de la même conclusion.
    if (connection === 'broken') {
      setActionError(hostAuthorityLostMessage())
      setActionPending(false)
      return
    }
    try {
      await emitAck(event, payload)
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
   * réellement arrivé du serveur permet d'avancer directement dessus.
   * Question non notée (sondage, nuage) : le serveur n'émet alors ni révélation ni classement et
   * enchaîne directement (question suivante ou podium) ; le flag n'est donc pas armé, sinon il
   * resterait levé et masquerait la révélation de la question suivante. */
  function skipQuestion(scored: boolean) {
    skipRequestedRef.current = scored
    setActionPending(true)
    setActionError(null)
    if (connection === 'broken') {
      skipRequestedRef.current = false
      setActionError(hostAuthorityLostMessage())
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

  /** Bascule le mode d'enchaînement automatique. Optimiste côté UI (coche immédiate), puis
   * `host:setAuto` côté serveur : couper le mode annule l'avance planifiée et efface le compte à
   * rebours (le serveur rediffuse `auto:advance { nextAt: null }`, géré par l'abonnement). Un échec
   * réseau laisse l'état serveur faire foi au prochain événement. */
  function toggleAuto(next: boolean) {
    setAutoAdvance(next)
    if (!next) setAutoNextAt(null)
    emitAck('host:setAuto', { enabled: next }).catch(() => {})
  }

  /** Libellé réutilisé sur les vues révélation et classement quand une avance est en attente. */
  const autoCountdownLabel =
    autoAdvance && autoRemaining !== null ? t('Question suivante dans {n} s', { n: autoRemaining }) : null

  async function createScreenLink() {
    if (!sessionId) return
    setScreenPending(true)
    setScreenError(null)
    setScreenCopyStatus(null)
    if (connection === 'broken') {
      setScreenError(hostAuthorityLostMessage())
      setScreenPending(false)
      return
    }
    try {
      const ack = await emitAck<ScreenTokenAck>('host:createScreenToken', {})
      setScreenUrl(buildScreenUrl(sessionId, ack.displayToken, pin, rawQuizTitle))
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
      setScreenCopyStatus(t('Lien copié.'))
    } catch {
      setScreenCopyStatus(t('Copie impossible, sélectionnez et copiez le lien manuellement.'))
    }
  }

  /* ---------------------------------------------------------------- */

  const connectedCount = players.filter((p) => p.connected).length
  const canLaunch = players.length > 0
  // Question non notée (sondage, nuage de mots) : jamais de classement après elle. La révélation
  // propose directement « Suivant », et un `scoreboard` reçu ne change pas la phase.
  const scored = question ? isScoredType(question.type) : true
  // Répartition d'un sondage : seulement si elle porte sur la question affichée.
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
  const maxRowCount = rows && rows.length > 0 ? Math.max(1, ...rows.map((r) => r.count)) : 1
  const revealedAnswerText = rows ? (rows.find((r) => r.correct)?.label ?? '') : ''
  const revealStatus =
    question?.type === 'wordcloud'
      ? t('Nuage de mots figé.')
      : question?.type === 'poll'
        ? t('Sondage clos.')
        : t('Réponse révélée : {answer}', { answer: revealedAnswerText })

  function renderWordcloud() {
    // Un nuage d'une autre question (course entre événements) n'est jamais affiché.
    const current = wordcloud && question && wordcloud.questionId === question.id ? wordcloud : null
    return (
      <div className="hostlive-wordcloud">
        <WordCloud
          words={current?.words ?? []}
          onRemove={(w) => void runHostAction('host:wordcloudRemove', { word: w.text })}
        />
        {current && <p className="hostlive-progress">{wordcloudSummary(current)}</p>}
      </div>
    )
  }

  function renderDistribution() {
    if (question?.type === 'wordcloud') return renderWordcloud()
    if (poll && poll.voters === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>{t('Aucun vote')}</p>
    }
    if (!rows) return null
    if (rows.length === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>{t('Aucune réponse reçue pour cette question.')}</p>
    }
    return (
      <ul className="hostlive-answers" aria-label={t('Réponses et distribution')}>
        {rows.map((row) => (
          <li key={row.key} className={`hostlive-answer-row${row.correct ? ' hostlive-answer-row--correct' : ''}`}>
            <span className="hostlive-answer-row__label">
              {row.label}
              {row.correct && (
                <span className="hostlive-answer-row__correct-tag">
                  <span aria-hidden="true">✓</span> {t('Bonne réponse')}
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
            {poll ? (
              <span className="hostlive-answer-row__count">
                {tp(row.count, '{n} vote', '{n} votes')},{' '}
                <span>{t('{percent}\u00a0%', { percent: pollPercent(row.count, poll.voters) })}</span>
              </span>
            ) : (
              <span className="hostlive-answer-row__count">{row.count}</span>
            )}
          </li>
        ))}
      </ul>
    )
  }

  function renderLeaderboard(limit: number, focusTarget: boolean) {
    const top = boardEntries(ranking, players).slice(0, limit)
    const hasRanking = ranking.length > 0
    if (top.length === 0) {
      return <p style={{ color: 'var(--ink-dim)' }}>{t("Le classement s'affichera après la première question.")}</p>
    }
    return (
      <>
        {focusTarget ? (
          <h2 ref={phaseHeadingRef} tabIndex={-1}>
            {t('Classement')}
          </h2>
        ) : (
          <h2>{t('Top joueurs')}</h2>
        )}
        <ol className="hostlive-board">
          {top.map((p, index) => (
            <li key={p.playerId} className="hostlive-board__row">
              {/* Avant le premier classement, l'ordre n'est que celui d'arrivée : pas de rang. */}
              {hasRanking && (
                <span className={`hostlive-board__rank${index === 0 ? ' hostlive-board__rank--first' : ''}`}>
                  {index + 1}
                </span>
              )}
              <span className="hostlive-board__name">{p.nickname}</span>
              <span className="hostlive-board__score">{t('{score} pts', { score: p.score })}</span>
              <Button
                variant="ghost"
                type="button"
                className="hostlive-kick"
                aria-label={t('Exclure {nickname}', { nickname: p.nickname })}
                disabled={kickPendingId === p.playerId}
                onClick={() => void kickPlayer(p.playerId, p.nickname)}
              >
                {t('Exclure')}
              </Button>
            </li>
          ))}
        </ol>
      </>
    )
  }

  // Liste repliable de tous les joueurs présents (retardataires et joueurs au-delà du top
  // compris), pour pouvoir exclure n'importe lequel en cours de partie.
  function renderAllPlayers() {
    if (players.length === 0) return null
    return (
      <details className="hostlive-all-players">
        <summary>{t('Tous les joueurs ({n})', { n: players.length })}</summary>
        <ul className="hostlive-board">
          {players.map((p) => (
            <li key={p.id} className="hostlive-board__row">
              <span className="hostlive-board__name">
                {p.nickname}
                {!p.connected && <span className="visually-hidden"> {t('(hors ligne)')}</span>}
              </span>
              <Button
                variant="ghost"
                type="button"
                className="hostlive-kick"
                aria-label={t('Exclure {nickname}', { nickname: p.nickname })}
                disabled={kickPendingId === p.id}
                onClick={() => void kickPlayer(p.id, p.nickname)}
              >
                {t('Exclure')}
              </Button>
            </li>
          ))}
        </ul>
      </details>
    )
  }

  return (
    <div className="ab-shell hostlive-shell">
      <header className="ab-shell__header hostlive-header">
        <Logo compact />
        <div className="hostlive-header__meta">
          <div style={{ minWidth: 0 }}>
            <span className="hostlive-header__title">{quizTitle}</span>
          </div>
          {pin ? (
            <PinDisplay pin={pin} compact label={t('Code PIN de la partie')} />
          ) : (
            <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
              {t('PIN indisponible (session atteinte sans passer par « Lancer la partie »).')}
            </p>
          )}
        </div>
        <div className="hostlive-header__status">
          <span className="host-badge">
            {tp(players.length, '{n} joueur', '{n} joueurs')}
            {phase !== 'lobby' && players.length > 0 ? ` (${tp(connectedCount, '{n} connecté', '{n} connectés')})` : ''}
          </span>
          <span className="host-badge">{phaseLabel(phase)}</span>
        </div>
      </header>

      {connection === 'reconnecting' && (
        <p className="player-net player-net--reconnecting" role="alert">
          {t('Connexion perdue, reconnexion…')}
        </p>
      )}
      {connection === 'broken' && (
        <p
          className="player-net player-net--reconnecting"
          role="alert"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <span>{hostAuthorityLostMessage()}</span>
          <Button variant="ghost" type="button" onClick={() => navigate('/')}>
            {t("Retour à l'éditeur")}
          </Button>
        </p>
      )}

      {/* Passerelle grand écran : lien à usage unique généré à la demande —
          voir buildScreenUrl ci-dessus pour pourquoi le PIN y est encodé. */}
      <div className="host-field" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button variant="ghost" type="button" disabled={screenPending} onClick={() => void createScreenLink()}>
            {screenPending ? t('Génération…') : screenUrl ? t('Régénérer le lien grand écran') : t('Grand écran')}
          </Button>
          {screenUrl && (
            <>
              <label htmlFor="hostlive-screen-url" className="visually-hidden">
                {t('Lien du grand écran')}
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
                {t('Copier')}
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
            {t(
              'À usage unique : ouvrez ce lien sur le projecteur AVANT de lancer la partie ; il devient invalide une fois utilisé.',
            )}
          </p>
        )}
      </div>

      {/* Enchaînement automatique : l'hôte garde la main pour reprendre le contrôle manuel. */}
      <div className="host-field" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoAdvance} onChange={(e) => toggleAuto(e.currentTarget.checked)} />
          <span>{t('Enchaînement automatique des étapes (10 s de pause sur le classement)')}</span>
        </label>
      </div>

      <main className="ab-shell__main hostlive-main" id="contenu-principal" tabIndex={-1}>
        <h1 className="visually-hidden">{t('Contrôleur hôte live')}</h1>

        {actionError && (
          <p className="join-error" role="alert">
            {actionError}
          </p>
        )}

        <div className="hostlive-layout">
          <section className="hostlive-primary" aria-label={t('Pilotage de la partie')}>
            {phase === 'lobby' && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  {t('En attente des joueurs')}
                </h2>
                <p style={{ color: 'var(--ink-dim)' }}>
                  {t('Partagez le PIN sur le grand écran, ou le lien ci-dessus.')}
                </p>

                {players.length === 0 ? (
                  <p className="hostlive-empty">
                    {t("Aucun joueur pour l'instant. La partie se lance dès qu'un joueur rejoint.")}
                  </p>
                ) : (
                  <ul className="hostlive-players" aria-label={t('Joueurs ayant rejoint la partie')}>
                    {players.map((p) => (
                      <li key={p.id} className="hostlive-players__chip">
                        {p.nickname}
                        {!p.connected && <span className="visually-hidden"> {t('(hors ligne)')}</span>}
                        <Button
                          variant="ghost"
                          type="button"
                          className="hostlive-kick"
                          aria-label={t('Exclure {nickname}', { nickname: p.nickname })}
                          disabled={kickPendingId === p.id}
                          onClick={() => void kickPlayer(p.id, p.nickname)}
                        >
                          {t('Exclure')}
                        </Button>
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
                    {actionPending ? t('Lancement…') : t('Lancer la partie')}
                  </Button>
                  {!canLaunch && (
                    <p className="hostlive-controls__hint" id="hostlive-launch-reason">
                      {t("En attente d'au moins un joueur pour lancer la partie.")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {phase === 'reading' && reading && (
              // Aucun contrôle hôte pendant la lecture : le serveur pilote seul la bascule vers
              // 'question' (`meta.readingTimeout`, voir game-gateway.ts) — l'hôte n'a rien à
              // cliquer, juste à patienter comme les joueurs et le grand écran. Cohérent avec le
              // snapshot reconnect (`emitReconnectSnapshot`) : un hôte qui reprend pendant la
              // lecture atterrit sur ce même bloc, via la même souscription `question:reading`.
              <div className="hostlive-phase">
                <div className="hostlive-phase__header">
                  <h2 ref={phaseHeadingRef} tabIndex={-1}>
                    {reading.prompt}
                  </h2>
                </div>
                <QuestionImage key={reading.media ?? ''} src={reading.media} alt={reading.mediaAlt} variant="host" />
                <p role="status" aria-live="polite">
                  {t('Lecture en cours… {n} s restantes', { n: readingRemaining ?? reading.readingTime })}
                </p>
              </div>
            )}

            {phase === 'question' && question && (
              <div className="hostlive-phase">
                <div className="hostlive-phase__header">
                  <h2 ref={phaseHeadingRef} tabIndex={-1}>
                    {question.prompt}
                  </h2>
                  <TimerRing
                    remainingSeconds={remaining ?? question.timeLimit}
                    totalSeconds={question.timeLimit}
                    size={72}
                  />
                </div>
                <QuestionImage key={question.media ?? ''} src={question.media} alt={question.mediaAlt} variant="host" />

                {question.type === 'poll' && (question.payload as { multiple?: boolean }).multiple && (
                  <p className="hostlive-progress">{t('Plusieurs réponses possibles')}</p>
                )}

                {question.type !== 'wordcloud' && (
                  <p className="hostlive-progress" aria-hidden="true">
                    {tp(progressAnswered, '{n} / {total} a répondu', '{n} / {total} ont répondu', {
                      total: formatNumber(players.length),
                    })}
                  </p>
                )}
                <p className="visually-hidden" role="status" aria-live="polite">
                  {respondedAnnouncement}
                </p>

                {question.type === 'wordcloud' && renderWordcloud()}

                <div className="hostlive-controls">
                  <Button variant="primary" type="button" disabled={actionPending} onClick={revealAnswer}>
                    {question.type === 'wordcloud'
                      ? t('Clore le nuage')
                      : question.type === 'poll'
                        ? t('Clore le sondage')
                        : t('Révéler la réponse')}
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={actionPending}
                    onClick={() => {
                      // Honnêteté : pour une question notée, `host:skip` est un ALIAS serveur de
                      // `host:reveal` (voir `doReveal`, game-gateway.ts) — il diffuse
                      // `question:reveal` à TOUTE la room comme un reveal normal ; seul
                      // `skipRequestedRef` (ci-dessus) empêche CET écran hôte de basculer sur la
                      // vue révélation. Les joueurs et le grand écran, eux, voient la réponse. Pour
                      // une question non notée (sondage, nuage), le serveur n'émet ni révélation ni
                      // classement et enchaîne directement : le message le dit tel quel.
                      if (
                        window.confirm(
                          scored
                            ? t(
                                'Révéler la réponse et passer directement au classement ? La réponse sera affichée aux joueurs et au grand écran.',
                              )
                            : t('Passer directement à la suite, sans afficher les résultats ?'),
                        )
                      ) {
                        skipQuestion(scored)
                      }
                    }}
                  >
                    {t('Passer')}
                  </Button>
                </div>
              </div>
            )}

            {phase === 'reveal' && question && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  {t('Révélation : {prompt}', { prompt: question.prompt })}
                </h2>
                <QuestionImage key={question.media ?? ''} src={question.media} alt={question.mediaAlt} variant="host" />
                <p className="visually-hidden" role="status" aria-live="polite">
                  {revealStatus}
                </p>

                {renderDistribution()}

                <div className="hostlive-controls">
                  {scored ? (
                    <Button variant="primary" type="button" onClick={goToScoreboard}>
                      {t('Afficher le classement')}
                    </Button>
                  ) : (
                    // Pas de classement après une question non notée : même avance que depuis
                    // l'écran de classement (le serveur tranche entre question suivante et fin).
                    <Button variant="primary" type="button" disabled={actionPending} onClick={advance}>
                      {actionPending ? '…' : t('Suivant')}
                    </Button>
                  )}
                  {autoCountdownLabel && (
                    <p className="hostlive-controls__hint" role="status" aria-live="polite">
                      {autoCountdownLabel}
                    </p>
                  )}
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
                    {actionPending ? '…' : t('Suivant')}
                  </Button>
                  {autoCountdownLabel && (
                    <p className="hostlive-controls__hint" role="status" aria-live="polite">
                      {autoCountdownLabel}
                    </p>
                  )}
                </div>
              </div>
            )}

            {phase === 'podium' && (
              <>
                {hasScoredQuestions ? (
                  <PodiumView
                    quizTitle={quizTitle}
                    top={podiumTop}
                    fullRanking={ranking}
                    headingRef={podiumHeadingRef}
                  />
                ) : (
                  <ClosingView quizTitle={quizTitle} headingRef={podiumHeadingRef} audience="room" />
                )}
                {/* Partie de démonstration : l'hôte invité se voit proposer un vrai compte. */}
                <GuestSignupOffer />
                <div className="hostlive-relaunch">
                  {relaunchLoadError ? (
                    <p className="join-error" role="alert">
                      {relaunchLoadError}
                    </p>
                  ) : relaunchQuizzes === null ? (
                    <p role="status">{t('Chargement de vos quiz…')}</p>
                  ) : relaunchQuizzes.length === 0 ? (
                    <p role="status">{t('Aucun quiz disponible à relancer.')}</p>
                  ) : (
                    <>
                      <label htmlFor="relaunch-quiz">{t('Quiz de la prochaine partie')}</label>
                      <select
                        id="relaunch-quiz"
                        value={relaunchQuizId}
                        onChange={(e) => setRelaunchQuizId(e.target.value)}
                      >
                        {relaunchQuizzes.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.title}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="primary"
                        type="button"
                        disabled={actionPending || !relaunchQuizId}
                        onClick={() => void relaunch()}
                      >
                        {t('Relancer une partie')}
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </section>

          {(phase === 'reading' || phase === 'question' || phase === 'reveal') && (
            <aside
              className="hostlive-aside"
              aria-label={scored ? t('Dernier classement connu') : t('Joueurs de la partie')}
            >
              {/* Question non notée (sondage, nuage) : pas de rappel du classement, hors sujet ici. */}
              {scored && renderLeaderboard(5, false)}
              {renderAllPlayers()}
            </aside>
          )}
          {phase === 'scoreboard' && players.length > 0 && (
            <aside className="hostlive-aside" aria-label={t('Joueurs de la partie')}>
              {renderAllPlayers()}
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}
