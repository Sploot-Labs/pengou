import { useEffect, useState } from 'react'
import { getRanking, mockPlayers, mockQuiz } from '../mockData'
import type { McqQuestion } from '../mockData'
import { AnswerTile, Button, TimerRing } from '../ui'

type PlayerState = 'waiting' | 'question' | 'result'

const question = mockQuiz.questions.find((q) => q.type === 'mcq') as McqQuestion

export function PlayerLive() {
  const [state, setState] = useState<PlayerState>('waiting')
  const [remaining, setRemaining] = useState(question.durationSeconds)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [score, setScore] = useState(0)

  useEffect(() => {
    if (state !== 'question') return
    if (remaining <= 0) {
      setState('result')
      return
    }
    const timer = window.setTimeout(() => setRemaining((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [state, remaining])

  function startQuestion() {
    setRemaining(question.durationSeconds)
    setSelectedOptionId(null)
    setState('question')
  }

  function pickAnswer(optionId: string) {
    if (state !== 'question') return
    setSelectedOptionId(optionId)
    const option = question.options.find((o) => o.id === optionId)
    if (option?.correct) {
      setScore((s) => s + question.points)
    }
    setState('result')
  }

  function backToWaiting() {
    setState('waiting')
    setSelectedOptionId(null)
  }

  const selectedOption = question.options.find((o) => o.id === selectedOptionId)
  const isCorrect = selectedOption?.correct ?? false

  const ranking = getRanking([...mockPlayers, { id: 'you', pseudo: 'Vous', score }])
  const myRank = ranking.find((p) => p.id === 'you')?.rank ?? ranking.length

  return (
    <div className="player-screen">
      <div className="player-status-bar">
        <span style={{ fontWeight: 700 }}>{mockQuiz.title}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>
          Score : {score}
        </span>
      </div>

      {state === 'waiting' && (
        <div className="player-waiting">
          <h1 style={{ fontSize: 'var(--fs-title)' }}>En attente de la prochaine question…</h1>
          <p style={{ color: 'var(--ink-dim)' }}>
            Restez sur cet écran. La question suivante s’affichera automatiquement.
          </p>
          <Button variant="primary" type="button" onClick={startQuestion}>
            Afficher la question (démo)
          </Button>
        </div>
      )}

      {state === 'question' && (
        <div className="player-question">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
            <TimerRing remainingSeconds={remaining} totalSeconds={question.durationSeconds} />
          </div>
          <p className="player-question__prompt">
            <strong>{question.prompt}</strong>
          </p>
          <div className="player-tiles" style={{ marginTop: 'var(--space-4)' }}>
            {question.options.map((opt) => (
              <AnswerTile
                key={opt.id}
                shape={opt.shape}
                label={opt.label}
                onClick={() => pickAnswer(opt.id)}
              />
            ))}
          </div>
        </div>
      )}

      {state === 'result' && (
        <div
          className={`player-result player-result--${isCorrect ? 'correct' : 'incorrect'}`}
          role="status"
        >
          <h1 style={{ fontSize: 'var(--fs-title)' }}>
            {selectedOptionId
              ? isCorrect
                ? 'Bonne réponse !'
                : 'Mauvaise réponse'
              : 'Temps écoulé'}
          </h1>
          {selectedOption && <p>Vous avez répondu : {selectedOption.label}</p>}
          <p className="player-result__points">
            +{isCorrect ? question.points : 0} points
          </p>
          <p>Classement provisoire : {myRank}ᵉ place</p>
          <Button variant="ghost" type="button" onClick={backToWaiting}>
            Revenir à l’attente (démo)
          </Button>
        </div>
      )}

      <div className="player-dev-controls">
        <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
          Contrôles de démonstration (simulent la progression de la partie)
        </p>
        <div className="player-dev-controls__row">
          <Button variant="ghost" type="button" onClick={() => setState('waiting')}>
            État : attente
          </Button>
          <Button variant="ghost" type="button" onClick={startQuestion}>
            État : question
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setSelectedOptionId(null)
              setState('result')
            }}
          >
            État : résultat
          </Button>
        </div>
      </div>
    </div>
  )
}
