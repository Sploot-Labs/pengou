import { useEffect, useRef, useState } from 'react'
import { getRanking, mockQuiz, sessionPlayers } from '../mockData'
import type { Question } from '../mockData'
import { AnswerTile, Button, TimerRing } from '../ui'

type ResultKind = 'correct' | 'partial' | 'incorrect' | 'timeout'
interface Evaluation {
  kind: ResultKind
  award: number
  /** Absolute distance to the correct slider value, when relevant. */
  sliderDiff: number | null
  /** True when the answer was submitted with time to spare (speed bonus). */
  fast: boolean
}

type PlayerState = 'waiting' | 'question' | 'answered' | 'result'
type Connection = 'online' | 'reconnecting' | 'reconnected'

/** Accent/diacritic-insensitive comparison for free-text answers. */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function PlayerLive() {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [state, setState] = useState<PlayerState>('waiting')
  const [remaining, setRemaining] = useState(mockQuiz.questions[0].durationSeconds)
  const [score, setScore] = useState(0)
  const [connection, setConnection] = useState<Connection>('online')

  // Captured answer, reset each question.
  const [optionId, setOptionId] = useState<string | null>(null)
  const [boolChoice, setBoolChoice] = useState<boolean | null>(null)
  const [textValue, setTextValue] = useState('')
  const [sliderValue, setSliderValue] = useState<number>(0)

  const question = mockQuiz.questions[questionIndex]

  const answeredRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (state !== 'question') return
    if (remaining <= 0) {
      // Time out with no submission: lock into the answered/waiting state.
      setState('answered')
      return
    }
    const timer = window.setTimeout(() => setRemaining((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [state, remaining])

  // WCAG 2.4.3: submitting disables the focused answer control, dropping focus
  // to <body>. Move focus to the confirmation message instead.
  useEffect(() => {
    if (state === 'answered') answeredRef.current?.focus()
  }, [state])

  // The « Reconnecté » banner must not linger the whole game — fade back to
  // « online » after a few seconds (announcement stays live meanwhile).
  useEffect(() => {
    if (connection !== 'reconnected') return
    const timer = window.setTimeout(() => setConnection('online'), 3000)
    return () => window.clearTimeout(timer)
  }, [connection])

  function resetAnswer(q: Question) {
    setOptionId(null)
    setBoolChoice(null)
    setTextValue('')
    setSliderValue(q.type === 'slider' ? q.min : 0)
  }

  function startQuestion(index = questionIndex) {
    const q = mockQuiz.questions[index]
    setQuestionIndex(index)
    setRemaining(q.durationSeconds)
    resetAnswer(q)
    setState('question')
  }

  /** Player has submitted — lock the UI, DO NOT reveal correctness yet. */
  function submitAnswer() {
    if (state !== 'question') return
    setState('answered')
  }

  /**
   * Score the current answer (mock). Correct answers earn a speed-modulated
   * award; the slider grants proximity (partial) credit near the target.
   * `remaining` is frozen at submission time (the timer only ticks while the
   * state is 'question'), so it doubles as the captured time-left.
   */
  function evaluate(): Evaluation {
    if (!hasSubmission()) return { kind: 'timeout', award: 0, sliderDiff: null, fast: false }
    const duration = question.durationSeconds
    const speedFactor = 0.5 + 0.5 * (Math.max(0, remaining) / duration)
    const fast = remaining / duration > 0.5

    if (question.type === 'slider') {
      const diff = Math.abs(sliderValue - question.correctValue)
      const range = Math.max(1, question.max - question.min)
      const tolBand = Math.max(1, Math.round(range * 0.05))
      if (diff === 0) {
        return { kind: 'correct', award: Math.round(question.points * speedFactor), sliderDiff: 0, fast }
      }
      if (diff <= tolBand) {
        const proximity = 1 - diff / (tolBand + 1)
        const base = question.points * 0.6 * proximity
        return { kind: 'partial', award: Math.round(base * speedFactor), sliderDiff: diff, fast }
      }
      return { kind: 'incorrect', award: 0, sliderDiff: diff, fast: false }
    }

    const ok = isCorrect()
    return {
      kind: ok ? 'correct' : 'incorrect',
      award: ok ? Math.round(question.points * speedFactor) : 0,
      sliderDiff: null,
      fast: ok && fast,
    }
  }

  /** Reveal correctness + points — driven by the host's REVEAL (demo control). */
  function reveal() {
    const award = evaluate().award
    if (award > 0) setScore((s) => s + award)
    setState('result')
  }

  function hasSubmission(): boolean {
    switch (question.type) {
      case 'mcq':
        return optionId !== null
      case 'truefalse':
        return boolChoice !== null
      case 'text':
        return textValue.trim().length > 0
      case 'slider':
        return true
    }
  }

  function isCorrect(): boolean {
    switch (question.type) {
      case 'mcq':
        return question.options.find((o) => o.id === optionId)?.correct ?? false
      case 'truefalse':
        return boolChoice === question.correctAnswer
      case 'text':
        return question.acceptedAnswers.some((a) => normalize(a) === normalize(textValue))
      case 'slider':
        return sliderValue === question.correctValue
    }
  }

  function backToWaiting() {
    setState('waiting')
    resetAnswer(question)
  }

  /** Reveal the answer key on the player's own screen (closes the loop). */
  function renderRecap() {
    switch (question.type) {
      case 'mcq':
        return (
          <div className="player-tiles">
            {question.options.map((opt) => (
              <AnswerTile
                key={opt.id}
                shape={opt.shape}
                label={opt.label}
                disabled
                reveal={opt.correct ? 'correct' : opt.id === optionId ? 'incorrect' : null}
              />
            ))}
          </div>
        )
      case 'truefalse': {
        const correctLabel = question.correctAnswer ? 'Vrai' : 'Faux'
        const chose = boolChoice === null ? null : boolChoice ? 'Vrai' : 'Faux'
        const wrong = chose !== null && boolChoice !== question.correctAnswer
        return (
          <>
            <div className="player-result__recap-line player-result__recap-line--correct">
              <span className="player-result__recap-mark" aria-hidden="true">
                ✓
              </span>
              <span>Bonne réponse : {correctLabel}</span>
            </div>
            {wrong && (
              <div className="player-result__recap-line player-result__recap-line--yours">
                <span className="player-result__recap-mark" aria-hidden="true">
                  ✕
                </span>
                <span>Votre réponse : {chose}</span>
              </div>
            )}
          </>
        )
      }
      case 'text':
        return (
          <div className="player-result__recap-line player-result__recap-line--correct">
            <span className="player-result__recap-mark" aria-hidden="true">
              ✓
            </span>
            <span>
              Réponse(s) acceptée(s) :{' '}
              {question.acceptedAnswers.filter((a) => a.trim().length > 0).join(' · ')}
            </span>
          </div>
        )
      case 'slider':
        return (
          <>
            <div className="player-result__recap-line player-result__recap-line--correct">
              <span className="player-result__recap-mark" aria-hidden="true">
                ✓
              </span>
              <span>Valeur correcte : {question.correctValue}</span>
            </div>
            <div className="player-result__recap-line">
              <span>Votre estimation : {sliderValue}</span>
            </div>
          </>
        )
    }
  }

  const evaluation = state === 'result' ? evaluate() : null

  const ranking = getRanking(
    sessionPlayers.map((p) => (p.id === 'you' ? { ...p, score } : p)),
  )
  const myRank = ranking.find((p) => p.id === 'you')?.rank ?? ranking.length

  const answeredMessage = 'Réponse enregistrée. En attente de la suite…'

  return (
    <main className="player-screen" id="contenu-principal" tabIndex={-1}>
      <div className="player-status-bar">
        <span style={{ fontWeight: 700 }}>{mockQuiz.title}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>
          Score : {score}
        </span>
      </div>

      {connection !== 'online' && (
        <p
          className={`player-net player-net--${connection}`}
          role="status"
          aria-live="polite"
        >
          {connection === 'reconnecting'
            ? 'Reconnexion…'
            : 'Reconnecté, score conservé.'}
        </p>
      )}

      {state === 'waiting' && (
        <div className="player-waiting">
          <h1 style={{ fontSize: 'var(--fs-title)' }}>En attente de la prochaine question…</h1>
          <p style={{ color: 'var(--ink-dim)' }}>
            Restez sur cet écran. La question suivante s’affichera automatiquement.
          </p>
          <Button variant="primary" type="button" onClick={() => startQuestion()}>
            Afficher la question (démo)
          </Button>
        </div>
      )}

      {(state === 'question' || state === 'answered') && (
        <div className="player-question">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
            <TimerRing remainingSeconds={remaining} totalSeconds={question.durationSeconds} />
          </div>
          <p className="player-question__prompt">
            <strong>{question.prompt}</strong>
          </p>

          <div style={{ marginTop: 'var(--space-4)' }}>
            {state === 'question' &&
              (question.type === 'mcq' || question.type === 'truefalse') && (
                <p className="player-commit-hint">Le premier appui valide votre réponse.</p>
              )}

            {question.type === 'mcq' && (
              <div className="player-tiles">
                {question.options.map((opt) => (
                  <AnswerTile
                    key={opt.id}
                    shape={opt.shape}
                    label={opt.label}
                    selected={state === 'answered' && optionId === opt.id}
                    disabled={state === 'answered'}
                    onClick={() => {
                      setOptionId(opt.id)
                      submitAnswer()
                    }}
                  />
                ))}
              </div>
            )}

            {question.type === 'truefalse' && (
              <div className="player-truefalse">
                {[true, false].map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    className={`player-tf-btn${
                      state === 'answered' && boolChoice === val ? ' player-tf-btn--selected' : ''
                    }`}
                    disabled={state === 'answered'}
                    aria-pressed={state === 'answered' && boolChoice === val}
                    onClick={() => {
                      setBoolChoice(val)
                      submitAnswer()
                    }}
                  >
                    {val ? 'Vrai' : 'Faux'}
                  </button>
                ))}
              </div>
            )}

            {question.type === 'text' && (
              <form
                className="player-text-answer"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (textValue.trim().length > 0) submitAnswer()
                }}
              >
                <label htmlFor="player-text-input" className="visually-hidden">
                  Votre réponse
                </label>
                <input
                  id="player-text-input"
                  type="text"
                  value={textValue}
                  disabled={state === 'answered'}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Tapez votre réponse"
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  type="submit"
                  disabled={state === 'answered' || textValue.trim().length === 0}
                >
                  Valider
                </Button>
              </form>
            )}

            {question.type === 'slider' && (
              <form
                className="player-slider-answer"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitAnswer()
                }}
              >
                <output htmlFor="player-slider-input">{sliderValue}</output>
                <label htmlFor="player-slider-input" className="visually-hidden">
                  Votre estimation (de {question.min} à {question.max})
                </label>
                <input
                  id="player-slider-input"
                  type="range"
                  min={question.min}
                  max={question.max}
                  step={question.step}
                  value={sliderValue}
                  disabled={state === 'answered'}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                />
                <Button variant="primary" type="submit" disabled={state === 'answered'}>
                  Valider
                </Button>
              </form>
            )}
          </div>

          {state === 'answered' && (
            <p
              className="player-answered"
              role="status"
              aria-live="polite"
              ref={answeredRef}
              tabIndex={-1}
            >
              {hasSubmission() ? answeredMessage : 'Temps écoulé. En attente de la suite…'}
            </p>
          )}
        </div>
      )}

      {state === 'result' && evaluation && (
        <div
          className={`player-result player-result--${
            evaluation.kind === 'correct'
              ? 'correct'
              : evaluation.kind === 'partial'
                ? 'partial'
                : 'incorrect'
          }`}
          role="status"
        >
          <h1 style={{ fontSize: 'var(--fs-title)' }}>
            {evaluation.kind === 'timeout'
              ? 'Temps écoulé'
              : evaluation.kind === 'correct'
                ? 'Bonne réponse !'
                : evaluation.kind === 'partial'
                  ? `À ${evaluation.sliderDiff} près !`
                  : 'Mauvaise réponse'}
          </h1>
          <p className="player-result__points">
            {evaluation.fast && evaluation.award > 0 && 'Rapide ! '}+{evaluation.award}
            {evaluation.kind === 'partial' ? ' points partiels' : ' points'}
          </p>

          <div className="player-result__recap">{renderRecap()}</div>

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
          <label
            className="player-dev-controls__type"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-dim)' }}>
              Type de question
            </span>
            <select
              value={questionIndex}
              onChange={(e) => startQuestion(Number(e.target.value))}
            >
              {mockQuiz.questions.map((q, i) => (
                <option key={q.id} value={i}>
                  {i + 1}. {q.type}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="player-dev-controls__row">
          <Button variant="ghost" type="button" onClick={() => setState('waiting')}>
            État : attente
          </Button>
          <Button variant="ghost" type="button" onClick={() => startQuestion()}>
            État : question
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={reveal}
            disabled={state === 'waiting'}
          >
            Révéler le résultat
          </Button>
        </div>
        <div className="player-dev-controls__row">
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              setConnection((c) => (c === 'online' ? 'reconnecting' : 'online'))
            }
          >
            {connection === 'online' ? 'Simuler une coupure' : 'Rétablir'}
          </Button>
          {connection === 'reconnecting' && (
            <Button variant="ghost" type="button" onClick={() => setConnection('reconnected')}>
              Simuler la reconnexion
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
