import { useEffect, useRef, useState } from 'react'
import {
  getRanking,
  mockDistributions,
  mockGamePin,
  playersAtQuestion,
  sessionPlayers,
} from '../mockData'
import type { AnswerShapeKind, Question } from '../mockData'
import { AnswerShape, Button, Logo, PinDisplay, TimerRing } from '../ui'
import { mockQuiz } from '../mockData'

type Phase = 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'end'

interface DistributionBar {
  label: string
  count: number
  correct: boolean
  /** QCM answer shape, or null for true/false and slider buckets. */
  shape: AnswerShapeKind | null
  color: string
}

/** Build the distribution shown only at REVEAL — never during the countdown. */
function revealBars(question: Question): DistributionBar[] | null {
  if (question.type === 'mcq') {
    const counts = mockDistributions[question.id] ?? question.options.map(() => 0)
    return question.options.map((opt, i) => ({
      label: opt.label,
      count: counts[i] ?? 0,
      correct: opt.correct,
      shape: opt.shape,
      color: `var(--ans-${opt.shape})`,
    }))
  }
  if (question.type === 'truefalse') {
    const counts = mockDistributions[question.id] ?? [0, 0]
    // Neutral bars — no invented QCM shape/colour on the projector.
    return [
      { label: 'Vrai', count: counts[0] ?? 0, correct: question.correctAnswer === true, shape: null, color: 'var(--brand-2)' },
      { label: 'Faux', count: counts[1] ?? 0, correct: question.correctAnswer === false, shape: null, color: 'var(--brand-2)' },
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
        label: `${lo}–${hi}`,
        count,
        correct: i === correctBucket,
        shape: null,
        color: 'var(--brand-2)',
      }
    })
  }
  return null
}

export function BigScreen() {
  const [phase, setPhase] = useState<Phase>('lobby')
  const [joined, setJoined] = useState<typeof sessionPlayers>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [remaining, setRemaining] = useState(mockQuiz.questions[0].durationSeconds)
  const [disconnectedIds, setDisconnectedIds] = useState<Set<string>>(new Set())
  const [announced, setAnnounced] = useState('')

  const question = mockQuiz.questions[questionIndex]
  const isLast = questionIndex === mockQuiz.questions.length - 1

  // Lobby: players trickle in.
  useEffect(() => {
    if (phase !== 'lobby') return
    if (joined.length >= sessionPlayers.length) return
    const timer = window.setTimeout(() => {
      setJoined((prev) => [...prev, sessionPlayers[prev.length]])
    }, 900)
    return () => window.clearTimeout(timer)
  }, [phase, joined])

  // Debounced screen-reader announcement of the joined count (avoids 7 rapid
  // announcements as players arrive one after another).
  useEffect(() => {
    if (phase !== 'lobby') return
    const timer = window.setTimeout(() => {
      const verb = joined.length > 1 ? 'ont' : 'a'
      setAnnounced(`${joined.length} joueur${joined.length > 1 ? 's' : ''} sur ${sessionPlayers.length} ${verb} rejoint la partie.`)
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

  function startGame() {
    setPhase('question')
    setQuestionIndex(0)
    setRemaining(mockQuiz.questions[0].durationSeconds)
  }

  function goToQuestion(index: number) {
    setQuestionIndex(index)
    setRemaining(mockQuiz.questions[index].durationSeconds)
    setPhase('question')
  }

  function restartLobby() {
    setPhase('lobby')
    setJoined([])
  }

  function toggleDisconnect() {
    setDisconnectedIds((prev) => {
      const next = new Set(prev)
      const last = joined[joined.length - 1]
      if (!last) return prev
      if (next.has(last.id)) next.delete(last.id)
      else next.add(last.id)
      return next
    })
  }

  // Cumulative scores through the current question so the ranking evolves
  // question-to-question rather than staying frozen on constant totals.
  const ranking = getRanking(playersAtQuestion(questionIndex))
  const bars = phase === 'reveal' ? revealBars(question) : null
  const maxCount = bars ? Math.max(1, ...bars.map((b) => b.count)) : 1

  // Live respondent count derived from the countdown, so the monitor moves
  // instead of showing a frozen « 4 / 7 ».
  const liveAnswered = Math.min(
    sessionPlayers.length,
    Math.round(sessionPlayers.length * (1 - remaining / question.durationSeconds)),
  )

  /** Read-only answer preview shown during the live question (never a button). */
  function renderLiveAnswers() {
    if (question.type === 'mcq') {
      return (
        <div className="big-answers">
          {question.options.map((opt) => (
            <div
              key={opt.id}
              className="big-answer"
              style={{
                ['--tile-color' as string]: `var(--ans-${opt.shape})`,
                ['--tile-ink' as string]: `var(--ans-${opt.shape}-ink)`,
              }}
            >
              <AnswerShape shape={opt.shape} size={36} />
              <span>{opt.label}</span>
            </div>
          ))}
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
      return (
        <div className="big-answer__range">
          <span>
            De {question.min} à {question.max}
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

  return (
    <main className="big-screen" id="contenu-principal" tabIndex={-1}>
      {/* Persistent join reminder for latecomers once the game is underway
          (the full PIN marquee + address only show in the lobby). */}
      {(phase === 'question' || phase === 'reveal' || phase === 'scoreboard') && (
        <div className="big-join-reminder">
          Rejoignez sur <strong>arena.app</strong> · PIN <strong>{mockGamePin}</strong>
        </div>
      )}

      {phase === 'lobby' && (
        <div className="big-lobby">
          <Logo />
          <div>
            <h1 className="ab-hero-title">{mockQuiz.title}</h1>
            <p className="big-lobby__tagline">Le quiz en direct, open-source.</p>
            <p className="big-lobby__proof">
              Rejoignez en 5 secondes, aucune appli à installer. Vos données restent chez vous.
            </p>
          </div>
          <p className="big-lobby__address">
            Rejoignez sur <strong>arena.app</strong>
          </p>
          <PinDisplay pin={mockGamePin} />

          {joined.length === 0 ? (
            <p className="big-lobby__empty">
              En attente des joueurs… Saisissez le PIN pour rejoindre.
            </p>
          ) : (
            <ul className="big-players" aria-label="Joueurs ayant rejoint la partie">
              {joined.map((p) => {
                const off = disconnectedIds.has(p.id)
                return (
                  <li
                    key={p.id}
                    className={`big-players__chip${off ? ' big-players__chip--off' : ''}`}
                  >
                    {p.pseudo}
                    {off && (
                      <span className="big-players__badge">
                        <span aria-hidden="true">⚠</span> déconnecté
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p role="status" aria-live="polite">
            {announced}
          </p>
        </div>
      )}

      {phase === 'question' && (
        <div className="big-live">
          <div className="big-live__header">
            <span className="host-badge">
              Question {questionIndex + 1} / {mockQuiz.questions.length}
            </span>
            <TimerRing
              remainingSeconds={remaining}
              totalSeconds={question.durationSeconds}
              size={180}
              large
            />
          </div>

          <h1 className="big-live__prompt">{question.prompt}</h1>

          {renderLiveAnswers()}

          <p className="big-live__answered">
            {liveAnswered} / {sessionPlayers.length} {liveAnswered <= 1 ? 'a' : 'ont'} répondu
          </p>
        </div>
      )}

      {phase === 'reveal' && (
        <div className="big-live">
          <div className="big-live__header">
            <span className="host-badge">
              Question {questionIndex + 1} / {mockQuiz.questions.length} — révélation
            </span>
          </div>

          <h1 className="big-live__prompt">{question.prompt}</h1>

          {bars ? (
            <div
              className="big-distribution"
              style={{ ['--dist-cols' as string]: String(bars.length) }}
            >
              {bars.map((bar, i) => (
                <div
                  className={`big-distribution__col${bar.correct ? ' big-distribution__col--correct' : ''}`}
                  key={`${bar.label}-${i}`}
                >
                  <div className="big-distribution__bar-track">
                    <div
                      className="big-distribution__bar"
                      style={{
                        height: `${(bar.count / maxCount) * 100}%`,
                        ['--bar-color' as string]: bar.color,
                      }}
                    />
                  </div>
                  <span className="big-distribution__label">
                    {bar.shape && <AnswerShape shape={bar.shape} size={20} />}
                    {bar.label}
                    {bar.correct && <span className="big-distribution__check" aria-hidden="true">✓</span>}
                    {bar.correct && <span className="visually-hidden"> (bonne réponse)</span>}
                  </span>
                  <span className="big-distribution__count">{bar.count} réponse(s)</span>
                </div>
              ))}
            </div>
          ) : question.type === 'text' ? (
            <div className="big-reveal-answer">
              <p className="big-reveal-answer__label">Réponse(s) acceptée(s)</p>
              <p className="big-reveal-answer__value">{question.acceptedAnswers.join(' · ')}</p>
              <p style={{ color: 'var(--ink-dim)' }}>
                {liveAnswered} réponses libres reçues sur {sessionPlayers.length}.
              </p>
            </div>
          ) : null}

          {question.type === 'slider' &&
            (() => {
              const range = Math.max(1, question.max - question.min)
              const tol = Math.max(1, Math.round(range * 0.05))
              const lo = Math.max(question.min, question.correctValue - tol)
              const hi = Math.min(question.max, question.correctValue + tol)
              return (
                <div className="big-reveal-answer">
                  <p className="big-reveal-answer__value">Valeur correcte : {question.correctValue}</p>
                  <p style={{ color: 'var(--ink-dim)' }}>
                    Zone acceptée (points de proximité) : {lo} – {hi}
                  </p>
                </div>
              )
            })()}
        </div>
      )}

      {phase === 'scoreboard' && (
        <div className="big-scoreboard">
          <h1 className="ab-hero-title">Classement</h1>
          <ol className="big-scoreboard__list">
            {/* No « you » highlight on the shared wall: a colour-only marker is
                invisible to colour-blind viewers and « you » is ambiguous on a
                projected screen. */}
            {ranking.slice(0, 5).map((p) => (
              <li key={p.id} className="big-scoreboard__row">
                <span
                  className={`big-scoreboard__rank${p.rank === 1 ? ' big-scoreboard__rank--first' : ''}`}
                >
                  {p.rank}
                </span>
                <span className="big-scoreboard__name">{p.pseudo}</span>
                <span className="big-scoreboard__score">{p.score} pts</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {phase === 'end' && (
        <div className="big-lobby">
          <h1 className="ab-hero-title">Partie terminée</h1>
          <p style={{ color: 'var(--ink-dim)' }}>
            Toutes les questions ont été jouées. Place au classement final.
          </p>
          <p style={{ color: 'var(--ink-dim)' }}>
            Ouvrez l’écran « Podium » pour le classement complet.
          </p>
        </div>
      )}

      {/* Demo control bar — this projector view is read-only (§5.2); these
          buttons only simulate what the host would drive from backstage. */}
      <div className="big-dev-controls">
        <p className="big-dev-controls__label">
          Contrôles de démonstration (piloterait l’hôte, pas le projecteur)
        </p>
        <div className="big-dev-controls__row">
          {phase === 'lobby' && (
            // Unlike HostLive's real "Lancer la partie" (which requires ≥1
            // joined player), this demo control intentionally has no such
            // gate — it's a simulation-only shortcut, not the operator surface.
            <Button variant="primary" type="button" onClick={startGame}>
              Lancer la partie
            </Button>
          )}
          {phase === 'lobby' && joined.length > 0 && (
            <Button variant="ghost" type="button" onClick={toggleDisconnect}>
              Simuler une déconnexion
            </Button>
          )}
          {phase === 'question' && (
            <Button variant="primary" type="button" onClick={() => setPhase('reveal')}>
              Révéler la réponse
            </Button>
          )}
          {phase === 'reveal' && (
            <Button variant="primary" type="button" onClick={() => setPhase('scoreboard')}>
              Afficher le classement
            </Button>
          )}
          {phase === 'scoreboard' &&
            (isLast ? (
              <Button variant="primary" type="button" onClick={() => setPhase('end')}>
                Voir le podium
              </Button>
            ) : (
              <Button variant="primary" type="button" onClick={() => goToQuestion(questionIndex + 1)}>
                Question suivante
              </Button>
            ))}
          {phase !== 'lobby' && (
            <Button variant="ghost" type="button" onClick={restartLobby}>
              Retour au lobby
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
