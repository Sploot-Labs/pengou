import { pollPercent } from '@splootlabs/quiz'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  getSessionReport,
  sessionCsvUrl,
  type SessionReport as SessionReportData,
  type SessionReportQuestion,
  type SessionStatus,
} from '../api/sessions'
import { Button, Logo, PinDisplay } from '../ui'
import { getLang } from '../i18n/lang'
import { formatDate as formatLocalDate, formatNumber, t, tp } from '../i18n/t'
import { useT } from '../i18n/useT'

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

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'lobby':
      return t('En attente')
    case 'active':
      return t('En cours')
    case 'ended':
      return t('Terminée')
    case 'abandoned':
      return t('Abandonnée')
  }
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : t('Une erreur réseau est survenue. Réessayez.')
}

function formatDate(iso: string | null): string {
  if (!iso) return t('Pas encore démarrée')
  return formatLocalDate(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })
}

/** Only rendered when BOTH timestamps are present — never a fabricated
 * duration for a session still in lobby or a game that never `ended`. */
function formatDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? t('{min} min {s} s', { min: minutes, s: seconds }) : t('{s} s', { s: seconds })
}

/** `avgTimeMs` is `null` when a question got zero answers — an average over
 * zero values doesn't exist, so this renders the explicit "—" the plan
 * requires rather than inventing a `0 s`. */
function formatAvgTime(avgTimeMs: number | null): string {
  if (avgTimeMs === null) return '-'
  const seconds = avgTimeMs / 1000
  // Le français garde le point de toFixed (sortie historique) ; les autres langues suivent leur locale.
  const text =
    getLang() === 'fr'
      ? seconds.toFixed(1)
      : formatNumber(seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return t('{s} s', { s: text })
}

/** `null` (no answers yet) is distinct from `0` (answered, all wrong) — both
 * render as text, never a bare percentage bar or colour swatch. */
function successRate(correctCount: number | null, answerCount: number): number | null {
  if (correctCount === null || answerCount === 0) return null
  return correctCount / answerCount
}

/** Nuage de mots : pas de taux de réussite, on résume la participation et les
 * quatre idées les plus fréquentes (la liste complète reste dans le CSV). */
function wordcloudSummary(cloud: {
  participants: number
  totalWords: number
  words: { text: string; count: number }[]
}): string {
  const head = t('Nuage de mots, {participants}, {words}', {
    participants: tp(cloud.participants, '{n} participant', '{n} participants'),
    words: tp(cloud.totalWords, '{n} mot', '{n} mots'),
  })
  if (cloud.words.length === 0) return t('{head}. Aucune idée proposée', { head })
  return t('{head} : {words}', {
    head,
    words: cloud.words
      .slice(0, 4)
      .map((w) => `${w.text} (${w.count})`)
      .join(', '),
  })
}

/** Sondage : participation puis une ligne par choix, dans l'ordre du quiz. */
function PollSummary({ poll }: { poll: NonNullable<SessionReportQuestion['poll']> }) {
  return (
    <>
      <span>
        {t('Sondage, {participants}', { participants: tp(poll.voters, '{n} participant', '{n} participants') })}
      </span>
      {poll.voters === 0 ? (
        <p style={{ margin: 0 }}>{t('Aucun vote')}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
          {poll.options.map((o, i) => (
            <li key={`${i}-${o.label}`}>
              {t('{label} : {votes} ({percent} %)', {
                label: o.label,
                votes: tp(o.votes, '{n} vote', '{n} votes'),
                percent: pollPercent(o.votes, poll.voters),
              })}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function SessionReport() {
  const { lang } = useT()
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
        <p role="status">{t('Chargement du rapport…')}</p>
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {t('Partie introuvable.')}
        </p>
        <Link className="ab-button ab-button--primary" to="/">
          {t("← Retour à l'accueil")}
        </Link>
      </main>
    )
  }

  if (error || !report) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {error ?? t('Une erreur inattendue est survenue.')}
        </p>
        <Button variant="primary" type="button" onClick={() => sessionId && load(sessionId)}>
          {t('Réessayer')}
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
    .filter((q) => q.wordcloud === null && q.poll === null)
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
              {t("← Retour à l'accueil")}
            </Link>
          </span>
        </div>
        <a className="ab-button ab-button--primary" href={`${sessionCsvUrl(session.id)}?lang=${lang}`} download>
          {t('Exporter en CSV')}
        </a>
      </header>

      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <h1 style={{ marginBottom: 'var(--space-2)' }}>{session.quizTitle}</h1>

        <div className="report-summary">
          <PinDisplay pin={session.pin} compact />
          <div className="report-summary__facts">
            <span className={`host-badge host-badge--${session.status}`}>{statusLabel(session.status)}</span>
            <span>{formatDate(session.startedAt)}</span>
            {session.startedAt && session.endedAt && (
              <span>{t('Durée : {duration}', { duration: formatDuration(session.startedAt, session.endedAt) })}</span>
            )}
          </div>
        </div>

        <div className="report-stats">
          <div className="report-stat">
            <span className="report-stat__value">{players.length}</span>
            <span className="report-stat__label">{tp(players.length, 'joueur', 'joueurs')}</span>
          </div>
          <div className="report-stat">
            <span className="report-stat__value">{questions.length}</span>
            <span className="report-stat__label">{tp(questions.length, 'question', 'questions')}</span>
          </div>
          {session.startedAt && session.endedAt && (
            <div className="report-stat">
              <span className="report-stat__value">{formatDuration(session.startedAt, session.endedAt)}</span>
              <span className="report-stat__label">{t('durée')}</span>
            </div>
          )}
        </div>

        <section aria-labelledby="report-players-heading" style={{ marginTop: 'var(--space-6)' }}>
          <h2 id="report-players-heading">{t('Joueurs')}</h2>
          {players.length === 0 ? (
            <p className="ab-empty-state">{t("Aucun joueur n'a rejoint cette partie.")}</p>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <caption className="visually-hidden">
                  {t('Classement des joueurs, du meilleur score au moins bon.')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Pseudo')}</th>
                    <th scope="col">{t('Score')}</th>
                    <th scope="col">{t('Réponses correctes')}</th>
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
          <h2 id="report-questions-heading">{t('Questions')}</h2>
          <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
            {t(
              'Cette liste reflète la version actuelle du quiz : si une question a été modifiée ou supprimée depuis cette partie, son contenu ci-dessous peut différer de ce qui a réellement été joué.',
            )}
          </p>
          {questions.length === 0 ? (
            <p className="ab-empty-state">{t("Ce quiz n'a aucune question.")}</p>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <caption className="visually-hidden">
                  {t("Taux de réussite et temps moyen par question, dans l'ordre du quiz.")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('N°')}</th>
                    <th scope="col">{t('Intitulé')}</th>
                    <th scope="col">{t('Taux de réussite')}</th>
                    <th scope="col">{t('Temps moyen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => {
                    const rate = successRate(q.correctCount, q.answerCount)
                    const isWorst = highlightWorst && q.wordcloud === null && q.poll === null && rate === worstRate
                    return (
                      <tr key={q.questionId}>
                        <td>{q.orderIndex + 1}</td>
                        <td>
                          {q.prompt}
                          {isWorst && (
                            <span className="host-badge host-badge--warn" style={{ marginLeft: 'var(--space-2)' }}>
                              {t('Question la plus ratée')}
                            </span>
                          )}
                        </td>
                        <td>
                          {q.wordcloud !== null ? (
                            wordcloudSummary(q.wordcloud)
                          ) : q.poll !== null ? (
                            <PollSummary poll={q.poll} />
                          ) : rate === null ? (
                            t('(aucune réponse)')
                          ) : (
                            t('{percent} % ({correct}/{total})', {
                              percent: Math.round(rate * 100),
                              correct: q.correctCount ?? 0,
                              total: q.answerCount,
                            })
                          )}
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
