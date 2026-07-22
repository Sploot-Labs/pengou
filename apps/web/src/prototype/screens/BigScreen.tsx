import { useEffect, useRef, useState } from 'react'
import { mockGamePin, mockPlayers, mockQuiz } from '../mockData'
import type { AnswerShapeKind, Question } from '../mockData'
import { AnswerShape, Button, PinDisplay, TimerRing } from '../ui'

type Phase = 'lobby' | 'live'

/** Mock per-answer counts, indexed to match each question's option order
 * (for mcq/truefalse). Purely illustrative for the prototype. */
const mockDistributions: Record<string, number[]> = {
  q1: [1, 4, 0, 1],
  q2: [4, 2],
  q3: [0, 1, 5, 0],
  q5: [1, 2, 2, 1, 0],
}

interface DistributionBar {
  shape: AnswerShapeKind
  label: string
  count: number
}

function distributionFor(question: Question): DistributionBar[] | null {
  if (question.type === 'mcq') {
    const counts = mockDistributions[question.id] ?? question.options.map(() => 0)
    return question.options.map((opt, i) => ({ shape: opt.shape, label: opt.label, count: counts[i] ?? 0 }))
  }
  if (question.type === 'truefalse') {
    const counts = mockDistributions[question.id] ?? [0, 0]
    return [
      { shape: 'triangle', label: 'Vrai', count: counts[0] ?? 0 },
      { shape: 'diamond', label: 'Faux', count: counts[1] ?? 0 },
    ]
  }
  return null
}

export function BigScreen() {
  const [phase, setPhase] = useState<Phase>('lobby')
  const [joined, setJoined] = useState<typeof mockPlayers>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [remaining, setRemaining] = useState(mockQuiz.questions[0].durationSeconds)
  const announceRef = useRef<HTMLParagraphElement>(null)

  const question = mockQuiz.questions[questionIndex]

  useEffect(() => {
    if (phase !== 'lobby') return
    if (joined.length >= mockPlayers.length) return
    const timer = window.setTimeout(() => {
      setJoined((prev) => [...prev, mockPlayers[prev.length]])
    }, 900)
    return () => window.clearTimeout(timer)
  }, [phase, joined])

  useEffect(() => {
    if (phase !== 'live') return
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRemaining((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [phase, remaining])

  function startGame() {
    setPhase('live')
    setQuestionIndex(0)
    setRemaining(mockQuiz.questions[0].durationSeconds)
  }

  function nextQuestion() {
    const next = (questionIndex + 1) % mockQuiz.questions.length
    setQuestionIndex(next)
    setRemaining(mockQuiz.questions[next].durationSeconds)
  }

  function restartLobby() {
    setPhase('lobby')
    setJoined([])
  }

  const bars = distributionFor(question)
  const maxCount = bars ? Math.max(1, ...bars.map((b) => b.count)) : 1

  return (
    <div className="big-screen">
      {phase === 'lobby' && (
        <div className="big-lobby">
          <h1 style={{ fontSize: 'var(--fs-display)' }}>{mockQuiz.title}</h1>
          <PinDisplay pin={mockGamePin} />
          <p style={{ color: 'var(--ink-dim)' }}>
            Rendez-vous sur l’écran « Rejoindre » et saisissez ce code.
          </p>

          <ul className="big-players" aria-label="Joueurs ayant rejoint la partie">
            {joined.map((p) => (
              <li key={p.id} className="big-players__chip">
                {p.pseudo}
              </li>
            ))}
          </ul>
          <p role="status" aria-live="polite" ref={announceRef}>
            {joined.length} joueur{joined.length > 1 ? 's' : ''} sur {mockPlayers.length} a rejoint
            la partie.
          </p>

          <Button variant="primary" type="button" onClick={startGame}>
            Lancer la partie
          </Button>
        </div>
      )}

      {phase === 'live' && (
        <div className="big-live">
          <div className="big-live__header">
            <span className="host-badge">
              Question {questionIndex + 1} / {mockQuiz.questions.length}
            </span>
            <TimerRing remainingSeconds={remaining} totalSeconds={question.durationSeconds} />
          </div>

          <h1 className="big-live__prompt">{question.prompt}</h1>

          {bars ? (
            <div className="big-distribution">
              {bars.map((bar) => (
                <div className="big-distribution__col" key={bar.label}>
                  <div className="big-distribution__bar-track">
                    <div
                      className="big-distribution__bar"
                      style={{
                        height: `${(bar.count / maxCount) * 100}%`,
                        ['--bar-color' as string]: `var(${
                          bar.shape === 'triangle'
                            ? '--ans-triangle'
                            : bar.shape === 'diamond'
                              ? '--ans-diamond'
                              : bar.shape === 'circle'
                                ? '--ans-circle'
                                : '--ans-square'
                        })`,
                      }}
                    />
                  </div>
                  <span className="big-distribution__label">
                    <AnswerShape shape={bar.shape} size={20} />
                    {bar.label}
                  </span>
                  <span className="big-distribution__count">{bar.count} réponse(s)</span>
                </div>
              ))}
            </div>
          ) : question.type === 'text' ? (
            <p className="ab-empty-state">5 réponses libres reçues sur {mockPlayers.length}.</p>
          ) : question.type === 'slider' ? (
            <p className="ab-empty-state">
              Estimation moyenne des joueurs : {question.correctValue} (valeur correcte)
            </p>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <Button variant="ghost" type="button" onClick={restartLobby}>
              Retour au lobby (démo)
            </Button>
            <Button variant="primary" type="button" onClick={nextQuestion}>
              Question suivante
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
