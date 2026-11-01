import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  getSessionReport,
  sessionCsvUrl,
  type SessionReport as SessionReportData,
  type SessionStatus,
} from '../api/sessions'
import { Button, Logo, PinDisplay } from '../ui'

/**
 * SessionReport — post-game report screen (Plan 07 Task 5), mounted at
 * `/sessions/:sessionId` (see `routes.tsx`). Reads the aggregate produced by
 * `getSessionReport` (server-computed, tenant-scoped — a 404 covers BOTH "no
 * such session" and "another tenant's session", never a distinct message for
 * either, matching the server's no-existence-oracle guarantee). Three exports:
 *  - the on-screen players/questions tables below;
 *  - the CSV download link (`sessionCsvUrl`), a plain same-origin `<a
 *    download>` so the browser's native download handling applies and the
 *    session cookie rides along automatically — no `fetch`/blob juggling.
 */

const STATUS_LABEL: Record<SessionStatus, string> = {
  lobby: 'En attente',
  active: 'En cours',
  ended: 'Terminée',
  abandoned: 'Abandonnée',
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur réseau est survenue. Réessayez.'
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Pas encore démarrée'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Only rendered when BOTH timestamps are present — never a fabricated
 * duration for a session still in lobby or a game that never `ended`. */
function formatDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`
}

/** `avgTimeMs` is `null` when a question got zero answers — an average over
 * zero values doesn't exist, so this renders the explicit "—" the plan
 * requires rather than inventing a `0 s`. */
function formatAvgTime(avgTimeMs: number | null): string {
  if (avgTimeMs === null) return '-'
  return `${(avgTimeMs / 1000).toFixed(1)} s`
}

/** `null` (no answers yet) is distinct from `0` (answered, all wrong) — both
 * render as text, never a bare percentage bar or colour swatch. */
function successRate(correctCount: number | null, answerCount: number): number | null {
  if (correctCount === null || answerCount === 0) return null
  return correctCount / answerCount
}

/** Nuage de mots : pas de taux de réussite, on résume la participation et les
 * quatre idées les plus fréquentes (la liste complète reste dans le CSV). */
function wordcloudSummary(cloud: { participants: number; words: { text: string; count: number }[] }): string {
  const head = `Nuage de mots, ${cloud.participants} participant${cloud.participants > 1 ? 's' : ''}`
  if (cloud.words.length === 0) return `${head}. Aucune idée proposée`
  return `${head} : ${cloud.words
    .slice(0, 4)
    .map((w) => `${w.text} (${w.count})`)
    .join(', ')}`
}

export function SessionReport() {
  // Guaranteed present by the matching route (`/sessions/:sessionId`).
  const { sessionId } = useParams<{ sessionId: string }>()

  const [report, setReport] = useState<SessionReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load(id: string) {
    setLoading(true)
    setNotFound(false)
    setError(null)
    getSessionReport(id)
      .then((data) => {
        setReport(data)
        setLoading(false)
      })
      .catch((err) => {
        setLoading(false)
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError(errorMessage(err))
        }
      })
  }

  useEffect(() => {
    if (!sessionId) return
    load(sessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (loading) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Chargement du rapport…</p>
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          Partie introuvable.
        </p>
        <Link className="ab-button ab-button--primary" to="/">
          ← Retour à l'accueil
        </Link>
      </main>
    )
  }

  if (error || !report) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {error ?? 'Une erreur inattendue est survenue.'}
        </p>
        <Button variant="primary" type="button" onClick={() => sessionId && load(sessionId)}>
          Réessayer
        </Button>
      </main>
    )
  }

  const { session, questions, players } = report

  // Lowest non-null success rate across questions that actually got
  // answers — used to flag the most-missed question(s) below. Excluded when
  // that minimum is 1 (nobody missed anything): marking a perfect score as
  // "most missed" would be inventing a problem that doesn't exist. Ties (two
  // questions sharing the worst rate) are ALL flagged, not an arbitrary one.
  const answeredRates = questions
    .filter((q) => q.wordcloud === null)
    .map((q) => successRate(q.correctCount, q.answerCount))
    .filter((rate): rate is number => rate !== null)
  const worstRate = answeredRates.length > 0 ? Math.min(...answeredRates) : null
  const highlightWorst = worstRate !== null && worstRate < 1

  return (
    <div className="ab-shell">
      <header className="ab-shell__header">
        <Logo to="/" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
            <Link className="host-link-button" to="/">
              ← Retour à l'accueil
            </Link>
          </span>
        </div>
        <a className="ab-button ab-button--primary" href={sessionCsvUrl(session.id)} download>
          Exporter en CSV
        </a>
      </header>

      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <h1 style={{ marginBottom: 'var(--space-2)' }}>{session.quizTitle}</h1>

        <div className="report-summary">
          <PinDisplay pin={session.pin} compact />
          <div className="report-summary__facts">
            <span className={`host-badge host-badge--${session.status}`}>
              {STATUS_LABEL[session.status]}
            </span>
            <span>{formatDate(session.startedAt)}</span>
            {session.startedAt && session.endedAt && (
              <span>Durée : {formatDuration(session.startedAt, session.endedAt)}</span>
            )}
          </div>
        </div>

        <div className="report-stats">
          <div className="report-stat">
            <span className="report-stat__value">{players.length}</span>
            <span className="report-stat__label">
              joueur{players.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="report-stat">
            <span className="report-stat__value">{questions.length}</span>
            <span className="report-stat__label">
              question{questions.length > 1 ? 's' : ''}
            </span>
          </div>
          {session.startedAt && session.endedAt && (
            <div className="report-stat">
              <span className="report-stat__value">
                {formatDuration(session.startedAt, session.endedAt)}
              </span>
              <span className="report-stat__label">durée</span>
            </div>
          )}
        </div>

        <section aria-labelledby="report-players-heading" style={{ marginTop: 'var(--space-6)' }}>
          <h2 id="report-players-heading">Joueurs</h2>
          {players.length === 0 ? (
            <p className="ab-empty-state">Aucun joueur n'a rejoint cette partie.</p>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <caption className="visually-hidden">
                  Classement des joueurs, du meilleur score au moins bon.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Pseudo</th>
                    <th scope="col">Score</th>
                    <th scope="col">Réponses correctes</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Server already sorts by totalScore desc (the podium order) — rendered as-is, not re-sorted. */}
                  {players.map((p) => (
                    <tr key={p.playerId}>
                      <td>{p.nickname}</td>
                      <td>{p.totalScore}</td>
                      <td>
                        {p.correctCount} / {p.answerCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="report-questions-heading" style={{ marginTop: 'var(--space-6)' }}>
          <h2 id="report-questions-heading">Questions</h2>
          <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
            Cette liste reflète la version actuelle du quiz : si une question a été modifiée ou
            supprimée depuis cette partie, son contenu ci-dessous peut différer de ce qui a
            réellement été joué.
          </p>
          {questions.length === 0 ? (
            <p className="ab-empty-state">Ce quiz n'a aucune question.</p>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <caption className="visually-hidden">
                  Taux de réussite et temps moyen par question, dans l'ordre du quiz.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">N°</th>
                    <th scope="col">Intitulé</th>
                    <th scope="col">Taux de réussite</th>
                    <th scope="col">Temps moyen</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => {
                    const rate = successRate(q.correctCount, q.answerCount)
                    const isWorst = highlightWorst && q.wordcloud === null && rate === worstRate
                    return (
                      <tr key={q.questionId}>
                        <td>{q.orderIndex + 1}</td>
                        <td>
                          {q.prompt}
                          {isWorst && (
                            <span className="host-badge host-badge--warn" style={{ marginLeft: 'var(--space-2)' }}>
                              Question la plus ratée
                            </span>
                          )}
                        </td>
                        <td>
                          {q.wordcloud !== null
                            ? wordcloudSummary(q.wordcloud)
                            : rate === null
                              ? '(aucune réponse)'
                              : `${Math.round(rate * 100)} % (${q.correctCount}/${q.answerCount})`}
                        </td>
                        <td>{formatAvgTime(q.avgTimeMs)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
