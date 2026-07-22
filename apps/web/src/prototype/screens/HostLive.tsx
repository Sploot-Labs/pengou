import { useEffect, useRef, useState } from 'react'
import {
  getRanking,
  mockGamePin,
  mockQuiz,
  playersAtQuestion,
  sessionPlayers,
} from '../mockData'
import type { AnswerShapeKind, Question } from '../mockData'
import { AnswerShape, Button, Logo, PinDisplay, TimerRing } from '../ui'

type Phase = 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'end'

/** Mock per-answer counts, indexed to match each question's option order
 * (mcq/truefalse) or slider buckets. Mirrors BigScreen's fixture so both the
 * operator remote and the projector agree on the same session's numbers. */
const mockDistributions: Record<string, number[]> = {
  q1: [1, 4, 0, 2],
  q2: [5, 2],
  q3: [0, 1, 6, 0],
  q5: [1, 2, 3, 1, 0],
}

interface DistRow {
  key: string
  label: string
  correct: boolean
  shape: AnswerShapeKind | null
  count: number
}

/** Builds the operator's distribution rows for the current question. `fraction`
 * scales the final mock counts down to simulate answers still coming in
 * (0 = none yet, 1 = everyone in — used at reveal). Only mcq/truefalse/slider
 * carry a per-option distribution; text questions are handled separately. */
function distributionRows(question: Question, fraction: number): DistRow[] | null {
  const scale = (n: number) => Math.round(n * Math.max(0, Math.min(1, fraction)))

  if (question.type === 'mcq') {
    const counts = mockDistributions[question.id] ?? question.options.map(() => 0)
    return question.options.map((opt, i) => ({
      key: opt.id,
      label: opt.label,
      correct: opt.correct,
      shape: opt.shape,
      count: scale(counts[i] ?? 0),
    }))
  }
  if (question.type === 'truefalse') {
    const counts = mockDistributions[question.id] ?? [0, 0]
    return [
      { key: 'true', label: 'Vrai', correct: question.correctAnswer === true, shape: null, count: scale(counts[0] ?? 0) },
      { key: 'false', label: 'Faux', correct: question.correctAnswer === false, shape: null, count: scale(counts[1] ?? 0) },
    ]
  }
  if (question.type === 'slider') {
    const counts = mockDistributions[question.id] ?? [0, 0, 0, 0, 0]
    const buckets = counts.length
    const span = (question.max - question.min) / buckets
    const correctBucket = Math.min(
      buckets - 1,
      Math.floor((question.correctValue - question.min) / span),
    )
    return counts.map((count, i) => {
      const lo = Math.round(question.min + i * span)
      const hi = Math.round(question.min + (i + 1) * span)
      return {
        key: String(i),
        label: `${lo}–${hi}`,
        correct: i === correctBucket,
        shape: null,
        count: scale(count),
      }
    })
  }
  return null
}

function phaseLabel(phase: Phase, questionIndex: number, total: number): string {
  switch (phase) {
    case 'lobby':
      return 'Lobby'
    case 'question':
      return `Question ${questionIndex + 1} / ${total}`
    case 'reveal':
      return `Révélation ${questionIndex + 1} / ${total}`
    case 'scoreboard':
      return 'Classement'
    case 'end':
      return 'Terminé'
  }
}

export function HostLive() {
  const [phase, setPhase] = useState<Phase>('lobby')
  const [joined, setJoined] = useState<typeof sessionPlayers>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [remaining, setRemaining] = useState(mockQuiz.questions[0].durationSeconds)
  const [lobbyAnnouncement, setLobbyAnnouncement] = useState('')
  const [respondedAnnouncement, setRespondedAnnouncement] = useState('')
  const [endMessage, setEndMessage] = useState<string | null>(null)

  const question = mockQuiz.questions[questionIndex]
  const isLast = questionIndex === mockQuiz.questions.length - 1
  const total = mockQuiz.questions.length

  // RGAA 2.4.3: on every phase change, move focus to the new phase's own
  // heading so a screen reader announces it — but never steal focus on the
  // very first render (the shared [contenu-principal] main already receives
  // it, like every other screen).
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    phaseHeadingRef.current?.focus()
  }, [phase])

  // Lobby: players trickle in (mirrors BigScreen so both surfaces describe
  // the same session).
  useEffect(() => {
    if (phase !== 'lobby') return
    if (joined.length >= sessionPlayers.length) return
    const timer = window.setTimeout(() => {
      setJoined((prev) => [...prev, sessionPlayers[prev.length]])
    }, 900)
    return () => window.clearTimeout(timer)
  }, [phase, joined])

  // Debounced screen-reader announcement of the joined count — avoids one
  // announcement per arrival.
  useEffect(() => {
    if (phase !== 'lobby') return
    const timer = window.setTimeout(() => {
      const verb = joined.length > 1 ? 'ont' : 'a'
      setLobbyAnnouncement(
        `${joined.length} joueur${joined.length > 1 ? 's' : ''} sur ${sessionPlayers.length} ${verb} rejoint la partie.`,
      )
    }, 600)
    return () => window.clearTimeout(timer)
  }, [phase, joined])

  // Countdown only during the active question.
  useEffect(() => {
    if (phase !== 'question') return
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRemaining((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [phase, remaining])

  // Live respondent count, derived from the countdown so the monitor moves.
  const liveAnswered = Math.min(
    sessionPlayers.length,
    Math.round(sessionPlayers.length * (1 - remaining / question.durationSeconds)),
  )

  // RGAA: the respondent counter is a MEASURED aria-live region — it must not
  // announce every tick. Debounce it exactly like the lobby arrival count
  // above; the visible number (below) still updates every second for sighted
  // operators.
  useEffect(() => {
    if (phase !== 'question') return
    const timer = window.setTimeout(() => {
      setRespondedAnnouncement(
        `${liveAnswered} sur ${sessionPlayers.length} ${liveAnswered > 1 ? 'ont' : 'a'} répondu.`,
      )
    }, 700)
    return () => window.clearTimeout(timer)
  }, [phase, liveAnswered])

  function startGame() {
    setPhase('question')
    setQuestionIndex(0)
    setRemaining(mockQuiz.questions[0].durationSeconds)
  }

  /** Ends the countdown early and shows the answer breakdown. */
  function revealAnswer() {
    setPhase('reveal')
  }

  /** « Passer » bypasses the reveal entirely for this question (e.g. a broken
   * question) and goes straight to the leaderboard, unlike « Révéler la
   * réponse » which stops to show the distribution. */
  function skipQuestion() {
    setPhase('scoreboard')
  }

  /** Reveal's « Question suivante »: always moves to the leaderboard next —
   * the leaderboard's own « Question suivante » is what advances the question. */
  function goToScoreboard() {
    setPhase('scoreboard')
  }

  function advanceFromScoreboard() {
    if (isLast) {
      setPhase('end')
      return
    }
    const next = questionIndex + 1
    setQuestionIndex(next)
    setRemaining(mockQuiz.questions[next].durationSeconds)
    setPhase('question')
  }

  const connectedCount = phase === 'lobby' ? joined.length : sessionPlayers.length
  const canLaunch = joined.length > 0
  const ranking = getRanking(playersAtQuestion(questionIndex))
  const rows = phase === 'question' || phase === 'reveal'
    ? distributionRows(question, phase === 'reveal' ? 1 : liveAnswered / sessionPlayers.length)
    : null
  const maxRowCount = rows ? Math.max(1, ...rows.map((r) => r.count)) : 1

  function renderDistribution() {
    if (rows) {
      return (
        <ul className="hostlive-answers" aria-label="Réponses et distribution en direct">
          {rows.map((row) => (
            <li
              key={row.key}
              className={`hostlive-answer-row${row.correct ? ' hostlive-answer-row--correct' : ''}`}
            >
              {row.shape && (
                <span className="hostlive-answer-row__shape" style={{ color: `var(--ans-${row.shape})` }}>
                  <AnswerShape shape={row.shape} size={22} />
                </span>
              )}
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
                  style={{ width: `${(row.count / maxRowCount) * 100}%` }}
                />
              </span>
              <span className="hostlive-answer-row__count">{row.count}</span>
            </li>
          ))}
        </ul>
      )
    }
    if (question.type === 'text') {
      const receivedFraction = phase === 'reveal' ? 1 : liveAnswered / sessionPlayers.length
      const received = Math.round(sessionPlayers.length * receivedFraction)
      return (
        <div className="hostlive-text-answer">
          <p className="hostlive-text-answer__label">Réponse(s) acceptée(s)</p>
          <p className="hostlive-text-answer__value">{question.acceptedAnswers.join(' · ')}</p>
          <p style={{ color: 'var(--ink-dim)' }}>
            {received} / {sessionPlayers.length} réponse(s) libre(s) reçue(s).
          </p>
        </div>
      )
    }
    return null
  }

  /**
   * `focusTarget` is true only for the scoreboard PHASE's own heading (the
   * one the phase-change effect must focus). The aside preview reuses the
   * same markup but must never fight it for the shared ref.
   */
  function renderLeaderboard(limit: number, focusTarget: boolean) {
    const top = ranking.slice(0, limit)
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
          {top.map((p) => (
            <li key={p.id} className="hostlive-board__row">
              <span
                className={`hostlive-board__rank${p.rank === 1 ? ' hostlive-board__rank--first' : ''}`}
              >
                {p.rank}
              </span>
              <span className="hostlive-board__name">{p.pseudo}</span>
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
          <span className="hostlive-header__title">{mockQuiz.title}</span>
          <PinDisplay pin={mockGamePin} compact label="Code PIN de la partie" />
        </div>
        <div className="hostlive-header__status">
          <span className="host-badge">
            {connectedCount} joueur{connectedCount > 1 ? 's' : ''} connecté{connectedCount > 1 ? 's' : ''}
          </span>
          <span className="host-badge">{phaseLabel(phase, questionIndex, total)}</span>
        </div>
      </header>

      <main className="ab-shell__main hostlive-main" id="contenu-principal" tabIndex={-1}>
        <h1 className="visually-hidden">Contrôleur hôte live</h1>

        <div className="hostlive-layout">
          <section className="hostlive-primary" aria-label="Pilotage de la partie">
            {phase === 'lobby' && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  En attente des joueurs
                </h2>
                <p style={{ color: 'var(--ink-dim)' }}>
                  Partagez le PIN <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-strong)' }}>{mockGamePin}</strong> sur le grand écran.
                </p>

                {joined.length === 0 ? (
                  <p className="hostlive-empty">
                    Aucun joueur pour l’instant. La partie se lance dès qu’un joueur rejoint.
                  </p>
                ) : (
                  <ul className="hostlive-players" aria-label="Joueurs ayant rejoint la partie">
                    {joined.map((p) => (
                      <li key={p.id} className="hostlive-players__chip">
                        {p.pseudo}
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
                    aria-disabled={!canLaunch}
                    aria-describedby={!canLaunch ? 'hostlive-launch-reason' : undefined}
                    onClick={(e) => {
                      if (!canLaunch) {
                        e.preventDefault()
                        return
                      }
                      startGame()
                    }}
                  >
                    Lancer la partie
                  </Button>
                  {!canLaunch && (
                    <p className="hostlive-controls__hint" id="hostlive-launch-reason">
                      En attente d’au moins un joueur pour lancer la partie.
                    </p>
                  )}
                </div>
              </div>
            )}

            {phase === 'question' && (
              <div className="hostlive-phase">
                <div className="hostlive-phase__header">
                  <h2 ref={phaseHeadingRef} tabIndex={-1}>
                    {question.prompt}
                  </h2>
                  <TimerRing remainingSeconds={remaining} totalSeconds={question.durationSeconds} size={72} />
                </div>

                <p className="hostlive-progress" aria-hidden="true">
                  {liveAnswered} / {sessionPlayers.length} {liveAnswered > 1 ? 'ont' : 'a'} répondu
                </p>
                <p className="visually-hidden" role="status" aria-live="polite">
                  {respondedAnnouncement}
                </p>

                {renderDistribution()}

                <div className="hostlive-controls">
                  <Button variant="primary" type="button" onClick={revealAnswer}>
                    Révéler la réponse
                  </Button>
                  <Button variant="ghost" type="button" onClick={skipQuestion}>
                    Passer
                  </Button>
                </div>
              </div>
            )}

            {phase === 'reveal' && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  {question.prompt}
                </h2>

                {renderDistribution()}

                <div className="hostlive-controls">
                  <Button variant="primary" type="button" onClick={goToScoreboard}>
                    Question suivante
                  </Button>
                </div>
              </div>
            )}

            {phase === 'scoreboard' && (
              <div className="hostlive-phase">
                {renderLeaderboard(8, true)}
                <div className="hostlive-controls">
                  {isLast ? (
                    <Button variant="primary" type="button" onClick={advanceFromScoreboard}>
                      Voir le podium
                    </Button>
                  ) : (
                    <Button variant="primary" type="button" onClick={advanceFromScoreboard}>
                      Question suivante
                    </Button>
                  )}
                </div>
              </div>
            )}

            {phase === 'end' && (
              <div className="hostlive-phase">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  Partie terminée
                </h2>
                <p style={{ color: 'var(--ink-dim)' }}>
                  Toutes les questions ont été jouées.
                </p>
                <div className="hostlive-controls">
                  <Button
                    variant="primary"
                    type="button"
                    onClick={() =>
                      setEndMessage(
                        'Podium affiché sur le grand écran (démonstration).',
                      )
                    }
                  >
                    Voir le podium
                  </Button>
                </div>
                {endMessage && (
                  <p role="status" aria-live="polite">
                    {endMessage}
                  </p>
                )}
              </div>
            )}
          </section>

          {phase !== 'lobby' && phase !== 'scoreboard' && (
            <aside className="hostlive-aside" aria-label="Classement en cours">
              {renderLeaderboard(5, false)}
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}
