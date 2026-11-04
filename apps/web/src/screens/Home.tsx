import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { archiveQuiz, createQuiz, listQuizzes, restoreQuiz, type QuizListItem } from '../api/quizzes'
import { listSessions, type SessionStatus, type SessionSummary } from '../api/sessions'
import { Reveal } from '../motion/index.js'
import { useLaunchGame } from '../realtime/useLaunchGame'
import { AppHeader } from '../ui/AppHeader.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { isQuizLimitError, QuizLimitNotice } from '../ui/QuizLimitNotice.js'
import { WorkspaceSwitcher } from '../ui/WorkspaceSwitcher.js'
import { AnswerShape, Button } from '../ui'
import { ANSWER_SHAPES } from '../constants'

/**
 * Home — the host's landing screen (Plan 07 Task 4), now living at `/`
 * (the quiz editor moved to `/quizzes/:quizId`, see `routes.tsx` and
 * `HostEditor.tsx`). Independent top-level sections, each with its own
 * loading/empty/error state so a slow or failing `listSessions()` never
 * blocks the (usually fast, and more important) quiz list from rendering:
 *  - **Mes quiz** — `listQuizzes()`, each a link to its editor, plus a
 *    "Nouveau quiz" inline form (`createQuiz` then navigate straight to the
 *    new quiz's editor — no separate empty "untitled quiz" step). Chaque carte
 *    porte aussi « Archiver » (avec confirmation) ; les quiz archivés vivent
 *    dans une section repliable « Archivés » (chargée à l'ouverture) d'où on
 *    peut les « Restaurer ».
 *  - **Parties** (Task 9) — split into « En cours » (`lobby`/`active`,
 *    routes back to the live host controller `/host/:id`) and
 *    « Historique » (`ended`/`abandoned` — Task 9 adds automatic abandon
 *    for inactivity, see the server sweep — both route to the (Task 5)
 *    report screen `/sessions/:id`), each a link showing quiz title, PIN,
 *    date, player count and status as visible TEXT (never colour alone).
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
 * `ended` OU `abandoned` (Task 9 : abandon automatique pour inactivité, voir le sweep serveur),
 * elle, n'a plus rien à « reprendre » : direction le rapport (`/sessions/:id`). `s.id` est l'id
 * `game_session` PERSISTÉ (celui que `listSessions()` connaît) — `host:reconnect` accepte aussi
 * bien cet id que l'id moteur en mémoire (voir sa doc, `game-gateway.ts`). */
function sessionHref(s: SessionSummary): string {
  const terminal = s.status === 'ended' || s.status === 'abandoned'
  return terminal ? `/sessions/${s.id}` : `/host/${s.id}`
}

/** Libellé d'affordance visuel (décoratif, `aria-hidden` — même convention que `home-card__cta`
 * ci-dessous pour les cartes de quiz) : distingue clairement, au survol de la liste, une partie
 * qu'on REPREND d'une partie dont on consulte le RAPPORT — le badge de statut seul (« En cours »,
 * « Terminée », « Abandonnée ») ne dit pas ce que le clic va faire. */
function sessionCtaLabel(s: SessionStatus): string {
  const terminal = s === 'ended' || s === 'abandoned'
  return terminal ? 'Voir le rapport →' : 'Reprendre →'
}

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
  const [quizLimit, setQuizLimit] = useState(false)
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
    setQuizLimit(false)
    try {
      const created = await createQuiz({ title: trimmed })
      // Navigate straight into the new quiz's editor — the whole point of
      // "Nouveau quiz" is to start editing it, not to admire it in a list.
      navigate(`/quizzes/${created.id}`)
    } catch (err) {
      if (isQuizLimitError(err)) setQuizLimit(true)
      else setNewQuizError(errorMessage(err))
      setNewQuizPending(false)
    }
  }

  // --- Archivage --------------------------------------------------------------
  // Un quiz archivé quitte « Mes quiz » (non lançable) mais ses parties et rapports restent :
  // il rejoint la section « Archivés », chargée paresseusement à sa première ouverture.
  const [announcement, setAnnouncement] = useState('')
  const quizzesHeadingRef = useRef<HTMLHeadingElement>(null)
  const [archiveTarget, setArchiveTarget] = useState<QuizListItem | null>(null)
  const [archivePending, setArchivePending] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [archived, setArchived] = useState<QuizListItem[]>([])
  const [archivedLoaded, setArchivedLoaded] = useState(false)
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [archivedError, setArchivedError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreLimit, setRestoreLimit] = useState(false)

  function loadArchived() {
    setArchivedLoading(true)
    setArchivedError(null)
    listQuizzes({ archived: true })
      .then((rows) => {
        setArchived(rows)
        setArchivedLoaded(true)
        setArchivedLoading(false)
      })
      .catch((err) => {
        setArchivedLoading(false)
        setArchivedError(errorMessage(err))
      })
  }

  async function confirmArchive() {
    if (!archiveTarget) return
    const target = archiveTarget
    setArchivePending(true)
    setArchiveError(null)
    try {
      const row = await archiveQuiz(target.id)
      // La carte (et donc le bouton d'origine) disparaît : le focus repart sur le titre de section.
      quizzesHeadingRef.current?.focus()
      setQuizzes((prev) => prev.filter((q) => q.id !== target.id))
      if (archivedLoaded) setArchived((prev) => [{ ...target, archivedAt: row.archivedAt }, ...prev])
      setArchiveTarget(null)
      setAnnouncement(`Quiz « ${target.title} » archivé.`)
    } catch (err) {
      setArchiveError(errorMessage(err))
    } finally {
      setArchivePending(false)
    }
  }

  async function handleRestore(target: QuizListItem) {
    setRestoringId(target.id)
    setRestoreError(null)
    setRestoreLimit(false)
    try {
      await restoreQuiz(target.id)
      setArchived((prev) => prev.filter((q) => q.id !== target.id))
      setQuizzes((prev) => [...prev, { ...target, archivedAt: null }])
      setAnnouncement(`Quiz « ${target.title} » restauré.`)
    } catch (err) {
      if (isQuizLimitError(err)) setRestoreLimit(true)
      else setRestoreError(errorMessage(err))
    } finally {
      setRestoringId(null)
    }
  }

  // --- Parties : En cours (lobby+active) et Historique (ended+abandoned) --------
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>([])
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)

  function loadSessions() {
    setSessionsLoading(true)
    setSessionsError(null)
    Promise.all([
      listSessions({ status: ['lobby', 'active'] }),
      listSessions({ status: ['ended', 'abandoned'] }),
    ])
      .then(([live, history]) => {
        setLiveSessions(live)
        setHistorySessions(history)
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

  const visibleHistory = showAllHistory ? historySessions : historySessions.slice(0, SESSIONS_PAGE_SIZE)
  const hiddenHistoryCount = historySessions.length - visibleHistory.length

  return (
    <div className="ab-shell">
      <div aria-hidden={archiveTarget ? true : undefined}>
        <AppHeader
          brandline={<span className="host-brandline__tagline">quiz en direct, open-source, chez vous ou dans le cloud</span>}
          actions={
            <>
              <WorkspaceSwitcher />
              <Button variant="ghost" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
                {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
              </Button>
            </>
          }
        />
      </div>

      <main
        className="ab-shell__main"
        id="contenu-principal"
        tabIndex={-1}
        aria-hidden={archiveTarget ? true : undefined}
      >
        <section className="home-hero">
          <div>
            <h1>Bonjour</h1>
            <p className="home-hero__sub">Prêt à lancer une partie&nbsp;?</p>
          </div>
          {/* Une fois le formulaire ouvert, l'action principale devient
              « Créer et ouvrir » : « Annuler » passe en ghost pour ne pas
              afficher deux boutons primaires côte à côte. */}
          <Button
            variant={creatingQuiz ? 'ghost' : 'primary'}
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
            <h2 id="home-quizzes-heading" ref={quizzesHeadingRef} tabIndex={-1}>Mes quiz</h2>
            <Link className="ab-button ab-button--ghost" to="/library">
              Bibliothèque
            </Link>
          </div>

          {creatingQuiz && (
            <form className="home-inline-form" onSubmit={(e) => void handleCreateQuiz(e)} noValidate>
              {quizLimit && <QuizLimitNotice />}
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
                  placeholder="Ex. Culture générale, spécial vendredi"
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
              <p>Pas encore de quiz. On vous fait de la place : créez-en un pour démarrer.</p>
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
                          Modifié le {formatDateOnly(q.updatedAt)}, {formatQuestionCount(q.questionCount)}
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
                      <div className="home-card__actions">
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
                        <Button
                          variant="ghost"
                          type="button"
                          className="home-card__archive"
                          aria-label={`Archiver le quiz ${q.title}`}
                          onClick={() => {
                            setArchiveError(null)
                            setArchiveTarget(q)
                          }}
                        >
                          Archiver
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Reveal>
          )}

          {/* Quiz archivés : repliés par défaut, chargés à la première ouverture seulement. */}
          <details
            className="home-archived"
            onToggle={(e) => {
              if (e.currentTarget.open && !archivedLoaded && !archivedLoading) loadArchived()
            }}
          >
            <summary className="home-archived__summary">Archivés</summary>
            {archivedLoading ? (
              <p role="status">Chargement des quiz archivés…</p>
            ) : archivedError ? (
              <div className="ab-empty-state">
                <p role="alert">{archivedError}</p>
                <Button variant="primary" type="button" onClick={loadArchived}>
                  Réessayer
                </Button>
              </div>
            ) : archived.length === 0 ? (
              <p className="ab-empty-state">Aucun quiz archivé.</p>
            ) : (
              <>
                {restoreLimit && <QuizLimitNotice />}
                {restoreError && (
                  <p className="join-error" role="alert">
                    {restoreError}
                  </p>
                )}
                <ul className="home-list">
                  {archived.map((q) => (
                    <li key={q.id} className="home-archived__item">
                      <Link className="home-list__item" to={`/quizzes/${q.id}`}>
                        <span className="home-list__title">{q.title}</span>
                        <span className="home-list__meta">
                          {q.archivedAt ? `Archivé le ${formatDateOnly(q.archivedAt)}, ` : ''}
                          {formatQuestionCount(q.questionCount)}
                        </span>
                      </Link>
                      <Button
                        variant="ghost"
                        type="button"
                        aria-label={`Restaurer le quiz ${q.title}`}
                        disabled={restoringId === q.id}
                        onClick={() => void handleRestore(q)}
                      >
                        {restoringId === q.id ? 'Restauration…' : 'Restaurer'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </section>

        <section aria-label="Parties">
          {(() => {
            const renderRow = (s: SessionSummary) => (
              <li key={s.id}>
                <Link className="home-list__item" to={sessionHref(s)}>
                  <span className="home-list__title">{s.quizTitle}</span>
                  <span className="home-list__meta">
                    PIN {s.pin}, {formatDate(s.startedAt)}, {s.playerCount} joueur
                    {s.playerCount > 1 ? 's' : ''}
                  </span>
                  <span className={`host-badge host-badge--${s.status}`}>{STATUS_LABEL[s.status]}</span>
                  <span className="home-list__cta" aria-hidden="true">{sessionCtaLabel(s.status)}</span>
                </Link>
              </li>
            )
            if (sessionsLoading) return <p role="status">Chargement des parties…</p>
            if (sessionsError && liveSessions.length === 0 && historySessions.length === 0) {
              return (
                <div className="ab-empty-state">
                  <p role="alert">{sessionsError}</p>
                  <Button variant="primary" type="button" onClick={loadSessions}>Réessayer</Button>
                </div>
              )
            }
            return (
              <>
                <section aria-labelledby="home-live-heading" style={{ marginBottom: 'var(--space-6)' }}>
                  <div className="home-section__header"><h2 id="home-live-heading">En cours</h2></div>
                  {liveSessions.length === 0 ? (
                    <p className="ab-empty-state">Aucune partie en cours, lancez-en une depuis un quiz.</p>
                  ) : (
                    <ul className="home-list">{liveSessions.map(renderRow)}</ul>
                  )}
                </section>

                <section aria-labelledby="home-history-heading">
                  <div className="home-section__header"><h2 id="home-history-heading">Historique</h2></div>
                  {historySessions.length === 0 ? (
                    <p className="ab-empty-state">Aucune partie terminée pour l'instant.</p>
                  ) : (
                    <>
                      <ul className="home-list">{visibleHistory.map(renderRow)}</ul>
                      {hiddenHistoryCount > 0 && (
                        <Button variant="ghost" type="button" onClick={() => setShowAllHistory(true)}>
                          Voir tout l'historique ({historySessions.length})
                        </Button>
                      )}
                    </>
                  )}
                </section>
              </>
            )
          })()}
        </section>
      </main>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {archiveTarget && (
        <ConfirmDialog
          id="home-archive-dialog"
          title="Archiver ce quiz ?"
          description={`« ${archiveTarget.title} » quittera « Mes quiz » et ne pourra plus être lancé. Ses parties passées et leurs rapports restent consultables, et vous pourrez le restaurer depuis la section « Archivés ».`}
          confirmLabel="Archiver"
          pendingLabel="Archivage…"
          pending={archivePending}
          error={archiveError}
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </div>
  )
}
