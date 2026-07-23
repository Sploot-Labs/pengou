import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { createQuiz, listQuizzes, type Quiz } from '../api/quizzes'
import { listSessions, type SessionStatus, type SessionSummary } from '../api/sessions'
import { Button, Logo } from '../ui'

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
}

/** `Intl`-based formatting, not a manual split: handles locale, and reads
 * clearly for a French host (`23 juil. 2026, 14:05`). `null` (session never
 * started — still in lobby) renders as an explicit label rather than a
 * blank cell or a fabricated date. */
function formatDate(iso: string | null): string {
  if (!iso) return 'Pas encore démarrée'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

export function Home() {
  const navigate = useNavigate()
  const { refresh: refreshSession } = useSession()
  const [signingOut, setSigningOut] = useState(false)

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
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [quizzesLoading, setQuizzesLoading] = useState(true)
  const [quizzesError, setQuizzesError] = useState<string | null>(null)

  const [creatingQuiz, setCreatingQuiz] = useState(false)
  const [newQuizTitle, setNewQuizTitle] = useState('')
  const [newQuizError, setNewQuizError] = useState<string | null>(null)
  const [newQuizPending, setNewQuizPending] = useState(false)
  const newQuizTitleRef = useRef<HTMLInputElement>(null)
  const newQuizButtonRef = useRef<HTMLButtonElement>(null)

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
      <header className="ab-shell__header">
        <Logo />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="host-brandline">
            <strong>Arena</strong> — quiz en direct, open-source · chez vous ou dans le cloud
          </p>
        </div>
        <Button variant="ghost" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
          {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
        </Button>
      </header>

      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <h1 style={{ marginBottom: 'var(--space-4)' }}>Accueil</h1>

        <section aria-labelledby="home-quizzes-heading" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="home-section__header">
            <h2 id="home-quizzes-heading">Mes quiz</h2>
            <Button
              variant="ghost"
              type="button"
              ref={newQuizButtonRef}
              onClick={() => {
                setCreatingQuiz((v) => !v)
                setNewQuizError(null)
              }}
            >
              {creatingQuiz ? 'Annuler' : 'Nouveau quiz'}
            </Button>
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
            <p className="ab-empty-state">
              Vous n'avez encore aucun quiz. Créez-en un pour commencer.
            </p>
          ) : (
            <ul className="home-list">
              {quizzes.map((q) => (
                <li key={q.id}>
                  <Link className="home-list__item" to={`/quizzes/${q.id}`}>
                    <span className="home-list__title">{q.title}</span>
                    {q.description && <span className="home-list__meta">{q.description}</span>}
                  </Link>
                </li>
              ))}
            </ul>
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
            <ul className="home-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link className="home-list__item" to={`/sessions/${s.id}`}>
                    <span className="home-list__title">{s.quizTitle}</span>
                    <span className="home-list__meta">
                      PIN {s.pin} · {formatDate(s.startedAt)} · {s.playerCount} joueur
                      {s.playerCount > 1 ? 's' : ''}
                    </span>
                    <span className="host-badge">{STATUS_LABEL[s.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
