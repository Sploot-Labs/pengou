import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { createQuiz, listQuizzes, type QuizListItem } from '../api/quizzes'
import { listSessions, type SessionStatus, type SessionSummary } from '../api/sessions'
import { Reveal } from '../motion/index.js'
import { useLaunchGame } from '../realtime/useLaunchGame'
import { AppHeader } from '../ui/AppHeader.js'
import { AnswerShape, Button } from '../ui'
import { ANSWER_SHAPES } from '../constants'

/**
 * Home — the host's landing screen (Plan 07 Task 4), now living at `/`
 * (the quiz editor moved to `/quizzes/:quizId`, see `routes.tsx` and
 * `HostEditor.tsx`). Two independent sections, each with its own
 * loading/empty/error state so a slow or failing `listSessions()` never
 * blocks the (usually fast, and more important) quiz list from rendering:
 *  - **Mes quiz** — `listQuizzes()`, each a link to its editor, plus a
 *    "Nouveau quiz" inline form (`createQuiz` then navigate straight to the
 *    new quiz's editor — no separate empty "untitled quiz" step).
 *  - **Parties récentes** — `listSessions()`, each a link to the (Task 5)
 *    report screen, showing quiz title, PIN, date, player count and status
 *    as visible TEXT (never colour alone).
 */

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur réseau est survenue. Réessayez.'
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  lobby: 'En attente',
  active: 'En cours',
  ended: 'Terminée',
  abandoned: 'Abandonnée',
}

/** Une partie encore vivante (`lobby`/`active`) mène vers le contrôleur hôte LIVE (`/host/:id`,
 * Task 8 : `host:reconnect` y repeuple l'état — lobby/joueurs, question en cours, classement —
 * via un snapshot poussé par le serveur, voir `HostLive.tsx`) — jamais vers le rapport, qui lit
 * des agrégats FIGÉS (`getSessionReport`) inadaptés à une partie encore en mouvement. Une partie
 * `ended`, elle, n'a plus rien à « reprendre » : direction le rapport (`/sessions/:id`). `s.id`
 * est l'id `game_session` PERSISTÉ (celui que `listSessions()` connaît) — `host:reconnect`
 * accepte aussi bien cet id que l'id moteur en mémoire (voir sa doc, `game-gateway.ts`). */
function sessionHref(s: SessionSummary): string {
  return s.status === 'ended' ? `/sessions/${s.id}` : `/host/${s.id}`
}

/** Libellé d'affordance visuel (décoratif, `aria-hidden` — même convention que `home-card__cta`
 * ci-dessous pour les cartes de quiz) : distingue clairement, au survol de la liste, une partie
 * qu'on REPREND d'une partie dont on consulte le RAPPORT — le badge de statut seul (« En cours »,
 * « Terminée ») ne dit pas ce que le clic va faire. */
function sessionCtaLabel(s: SessionStatus): string {
  return s === 'ended' ? 'Voir le rapport →' : 'Reprendre →'
}

type SessionFilter = 'all' | SessionStatus

/** Filter chips shown above "Parties récentes" — order matches the brief:
 * Toutes / En cours / En attente / Terminées (not the `SessionStatus` key
 * order, which reads lobby/active/ended). */
const SESSION_FILTERS: { key: SessionFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'active', label: 'En cours' },
  { key: 'lobby', label: 'En attente' },
  { key: 'ended', label: 'Terminées' },
]

/** How many rows render before the "Voir toutes" ghost button takes over —
 * keeps a tenant with hundreds of sessions from turning this into an
 * unscrollable wall by default. */
const SESSIONS_PAGE_SIZE = 8

/** `Intl`-based formatting, not a manual split: handles locale, and reads
 * clearly for a French host (`23 juil. 2026, 14:05`). `null` (session never
 * started — still in lobby) renders as an explicit label rather than a
 * blank cell or a fabricated date. */
function formatDate(iso: string | null): string {
  if (!iso) return 'Pas encore démarrée'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Format a date string as `23 juil. 2026` for the quiz card metadata. */
function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' })
}

/** `0 question` / `1 question` / `N questions` (Task 6) — plural agreement,
 * not just an `s` tacked onto a count. */
function formatQuestionCount(count: number): string {
  return `${count} question${count > 1 ? 's' : ''}`
}

export function Home() {
  const navigate = useNavigate()
  const { refresh: refreshSession } = useSession()
  const [signingOut, setSigningOut] = useState(false)
  // Task 7: "Lancer" on a quiz card reuses the SAME shared socket as
  // `HostEditor`/`HostLive` (see `HostRealtimeLayout` in `routes.tsx`) via this hook, instead of
  // requiring a detour through the editor just to start a game.
  const { launch, launching: gameLaunching, error: launchError } = useLaunchGame()

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      // Best-effort — see the identical rationale in HostEditor.handleSignOut.
    } finally {
      await refreshSession()
      navigate('/login')
    }
  }

  // --- Mes quiz -----------------------------------------------------------
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([])
  const [quizzesLoading, setQuizzesLoading] = useState(true)
  const [quizzesError, setQuizzesError] = useState<string | null>(null)

  const [creatingQuiz, setCreatingQuiz] = useState(false)
  const [newQuizTitle, setNewQuizTitle] = useState('')
  const [newQuizError, setNewQuizError] = useState<string | null>(null)
  const [newQuizPending, setNewQuizPending] = useState(false)
  const newQuizTitleRef = useRef<HTMLInputElement>(null)

  function loadQuizzes() {
    setQuizzesLoading(true)
    setQuizzesError(null)
    listQuizzes()
      .then((rows) => {
        setQuizzes(rows)
        setQuizzesLoading(false)
      })
      .catch((err) => {
        setQuizzesLoading(false)
        setQuizzesError(errorMessage(err))
      })
  }

  useEffect(() => {
    loadQuizzes()
  }, [])

  useEffect(() => {
    if (creatingQuiz) newQuizTitleRef.current?.focus()
  }, [creatingQuiz])

  async function handleCreateQuiz(event: FormEvent) {
    event.preventDefault()
    const trimmed = newQuizTitle.trim()
    if (trimmed.length === 0) {
      setNewQuizError('Le titre est requis.')
      newQuizTitleRef.current?.focus()
      return
    }
    setNewQuizPending(true)
    try {
      const created = await createQuiz({ title: trimmed })
      // Navigate straight into the new quiz's editor — the whole point of
      // "Nouveau quiz" is to start editing it, not to admire it in a list.
      navigate(`/quizzes/${created.id}`)
    } catch (err) {
      setNewQuizError(errorMessage(err))
      setNewQuizPending(false)
    }
  }

  // --- Parties récentes -----------------------------------------------------
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [showAllSessions, setShowAllSessions] = useState(false)

  const filteredSessions =
    sessionFilter === 'all' ? sessions : sessions.filter((s) => s.status === sessionFilter)
  const visibleSessions = showAllSessions
    ? filteredSessions
    : filteredSessions.slice(0, SESSIONS_PAGE_SIZE)
  const hiddenSessionCount = filteredSessions.length - visibleSessions.length

  function selectSessionFilter(next: SessionFilter) {
    setSessionFilter(next)
    // A new filter starts collapsed again — "Voir toutes" is scoped to
    // whichever filter was active when it was clicked, not a global switch.
    setShowAllSessions(false)
  }

  function loadSessions() {
    setSessionsLoading(true)
    setSessionsError(null)
    listSessions()
      .then((rows) => {
        setSessions(rows)
        setSessionsLoading(false)
      })
      .catch((err) => {
        setSessionsLoading(false)
        setSessionsError(errorMessage(err))
      })
  }

  useEffect(() => {
    loadSessions()
  }, [])

  return (
    <div className="ab-shell">
      <AppHeader
        brandline="quiz en direct, open-source · chez vous ou dans le cloud"
        actions={
          <Button variant="ghost" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
            {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </Button>
        }
      />

      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <section className="home-hero">
          <div>
            <h1>Bonjour 👋</h1>
            <p className="home-hero__sub">Prêt à lancer une partie&nbsp;?</p>
          </div>
          <Button
            variant="primary"
            type="button"
            aria-expanded={creatingQuiz}
            onClick={() => {
              setCreatingQuiz((v) => !v)
              setNewQuizError(null)
            }}
          >
            {creatingQuiz ? 'Annuler' : '+ Nouveau quiz'}
          </Button>
        </section>

        <section aria-labelledby="home-quizzes-heading" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="home-section__header">
            <h2 id="home-quizzes-heading">Mes quiz</h2>
          </div>

          {creatingQuiz && (
            <form className="home-inline-form" onSubmit={(e) => void handleCreateQuiz(e)} noValidate>
              {newQuizError && (
                <p className="join-error" role="alert" id="new-quiz-title-error">
                  {newQuizError}
                </p>
              )}
              <div className="host-field">
                <label htmlFor="new-quiz-title">Titre du nouveau quiz</label>
                <input
                  id="new-quiz-title"
                  ref={newQuizTitleRef}
                  type="text"
                  value={newQuizTitle}
                  onChange={(e) => setNewQuizTitle(e.target.value)}
                  placeholder="Ex. Culture générale — spécial vendredi"
                  aria-invalid={newQuizError ? true : undefined}
                  aria-describedby={newQuizError ? 'new-quiz-title-error' : undefined}
                />
              </div>
              <Button variant="primary" type="submit" disabled={newQuizPending}>
                {newQuizPending ? 'Création…' : 'Créer et ouvrir'}
              </Button>
            </form>
          )}

          {quizzesLoading ? (
            <p role="status">Chargement de vos quiz…</p>
          ) : quizzesError && quizzes.length === 0 ? (
            <div className="ab-empty-state">
              <p role="alert">{quizzesError}</p>
              <Button variant="primary" type="button" onClick={loadQuizzes}>
                Réessayer
              </Button>
            </div>
          ) : quizzes.length === 0 ? (
            <div className="ab-empty-state">
              {/* Discreet nod to the brand's answer-shape motif (logo, editor) —
                  purely decorative, so it stays out of the accessible name. */}
              <div className="home-empty-motif" aria-hidden="true">
                {ANSWER_SHAPES.map((shape) => (
                  <span
                    key={shape}
                    className="home-empty-motif__shape"
                    style={{ color: `var(--ans-${shape})` }}
                  >
                    <AnswerShape shape={shape} size={22} />
                  </span>
                ))}
              </div>
              <p>Pas encore de quiz. On te fait de la place — crée-en un pour démarrer. 🐾</p>
            </div>
          ) : (
            <Reveal from="up">
              {launchError && (
                <p className="join-error" role="alert">
                  {launchError}
                </p>
              )}
              <ul className="home-cards">
                {quizzes.map((q, i) => {
                  const shape = ANSWER_SHAPES[i % ANSWER_SHAPES.length]
                  return (
                    <li key={q.id} className="home-card-item">
                      <Link className="home-card" to={`/quizzes/${q.id}`}>
                        {/* Corner signature glyph — decorative only, cycles the
                            4 answer shapes so the dashboard echoes the brand
                            motif shown in the logo and the editor. */}
                        <span
                          className="home-card__glyph"
                          aria-hidden="true"
                          style={{ color: `var(--ans-${shape})` }}
                        >
                          <AnswerShape shape={shape} size={18} />
                        </span>
                        <span className="home-card__title">{q.title}</span>
                        {q.description && <span className="home-card__desc">{q.description}</span>}
                        <span className="home-card__meta">
                          Modifié le {formatDateOnly(q.updatedAt)} · {formatQuestionCount(q.questionCount)}
                        </span>
                        <span className="home-card__cta" aria-hidden="true">
                          Ouvrir →
                        </span>
                      </Link>
                      {/* Sibling of the `<Link>` above, NOT nested inside it — a `<button>` inside
                          an `<a>` is invalid HTML, and clicking it would also fire the link's
                          navigation. Launching here reuses the same shared socket as the editor's
                          own "Lancer la partie" (`useLaunchGame`), so a host doesn't need to open
                          the editor first just to start a game from an already-finished quiz. */}
                      <Button
                        variant="ghost"
                        type="button"
                        className="home-card__launch"
                        disabled={gameLaunching}
                        onClick={() => {
                          // `launch` rethrows so `HostEditor` can react to its own flush/launch
                          // sequencing — here the failure is already reflected in `launchError`
                          // (via the hook's own `error` state) above, so it's swallowed rather
                          // than left as an unhandled rejection.
                          launch(q.id, q.title).catch(() => {})
                        }}
                      >
                        {gameLaunching ? 'Lancement…' : 'Lancer'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </Reveal>
          )}
        </section>

        <section aria-labelledby="home-sessions-heading">
          <div className="home-section__header">
            <h2 id="home-sessions-heading">Parties récentes</h2>
          </div>

          {sessionsLoading ? (
            <p role="status">Chargement des parties récentes…</p>
          ) : sessionsError && sessions.length === 0 ? (
            <div className="ab-empty-state">
              <p role="alert">{sessionsError}</p>
              <Button variant="primary" type="button" onClick={loadSessions}>
                Réessayer
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <p className="ab-empty-state">
              Aucune partie pour l'instant — lancez-en une depuis un quiz.
            </p>
          ) : (
            <>
              <div className="home-filters" role="group" aria-label="Filtrer les parties par statut">
                {SESSION_FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    variant="ghost"
                    type="button"
                    aria-pressed={sessionFilter === f.key}
                    onClick={() => selectSessionFilter(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>

              {filteredSessions.length === 0 ? (
                <p className="ab-empty-state">Aucune partie ne correspond à ce filtre.</p>
              ) : (
                <>
                  <ul className="home-list">
                    {visibleSessions.map((s) => (
                      <li key={s.id}>
                        <Link className="home-list__item" to={sessionHref(s)}>
                          <span className="home-list__title">{s.quizTitle}</span>
                          <span className="home-list__meta">
                            PIN {s.pin} · {formatDate(s.startedAt)} · {s.playerCount} joueur
                            {s.playerCount > 1 ? 's' : ''}
                          </span>
                          <span className={`host-badge host-badge--${s.status}`}>
                            {STATUS_LABEL[s.status]}
                          </span>
                          <span className="home-list__cta" aria-hidden="true">
                            {sessionCtaLabel(s.status)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  {hiddenSessionCount > 0 && (
                    <Button variant="ghost" type="button" onClick={() => setShowAllSessions(true)}>
                      Voir toutes les parties ({filteredSessions.length})
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
