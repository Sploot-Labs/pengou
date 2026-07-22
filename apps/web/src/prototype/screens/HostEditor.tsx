import { useState } from 'react'
import type { AnswerShapeKind, McqQuestion, Question, QuestionType } from '../mockData'
import { mockQuiz } from '../mockData'
import { AnswerShape, Button, Logo } from '../ui'

const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'QCM',
  truefalse: 'Vrai / Faux',
  text: 'Réponse libre',
  slider: 'Curseur',
}

const MCQ_SHAPES: AnswerShapeKind[] = ['triangle', 'diamond', 'circle', 'square']

let idCounter = 1000
function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function createDefaultQuestion(type: QuestionType): Question {
  const base = {
    id: nextId('q'),
    prompt: '',
    durationSeconds: 20,
    points: 1000,
  }
  switch (type) {
    case 'mcq':
      return {
        ...base,
        type: 'mcq',
        options: MCQ_SHAPES.map((shape, index) => ({
          id: nextId('opt'),
          shape,
          label: '',
          correct: index === 0,
        })),
      }
    case 'truefalse':
      return { ...base, type: 'truefalse', correctAnswer: true }
    case 'text':
      return { ...base, type: 'text', acceptedAnswers: [''] }
    case 'slider':
      return { ...base, type: 'slider', min: 0, max: 100, step: 1, correctValue: 50 }
  }
}

export function HostEditor() {
  const [questions, setQuestions] = useState<Question[]>(mockQuiz.questions)
  const [selectedId, setSelectedId] = useState<string | null>(mockQuiz.questions[0]?.id ?? null)

  const selectedIndex = questions.findIndex((q) => q.id === selectedId)
  const selected = selectedIndex >= 0 ? questions[selectedIndex] : null

  function updateSelected(patch: Partial<Question>) {
    if (!selected) return
    setQuestions((prev) =>
      prev.map((q) => (q.id === selected.id ? ({ ...q, ...patch } as Question) : q)),
    )
  }

  function changeType(type: QuestionType) {
    if (!selected) return
    const draft = createDefaultQuestion(type)
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === selected.id ? { ...draft, id: q.id, prompt: q.prompt, durationSeconds: q.durationSeconds, points: q.points } : q,
      ),
    )
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    setQuestions((prev) => {
      const next = [...prev]
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
  }

  function addQuestion() {
    const draft = createDefaultQuestion('mcq')
    setQuestions((prev) => [...prev, draft])
    setSelectedId(draft.id)
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => {
      const next = prev.filter((q) => q.id !== id)
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null)
      }
      return next
    })
  }

  return (
    <div className="ab-shell">
      <header className="ab-shell__header">
        <Logo />
        <div>
          <p className="visually-hidden">Éditeur de quiz</p>
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
            {mockQuiz.title}
          </span>
        </div>
        <Button variant="primary" type="button">
          Lancer la partie
        </Button>
      </header>

      <main className="ab-shell__main">
        <h1 style={{ marginBottom: 'var(--space-4)' }}>Éditeur de quiz</h1>

        <div className="host-layout">
          <section aria-label="Liste des questions">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-3)' }}>Questions</h2>
            {questions.length === 0 ? (
              <p className="ab-empty-state">Aucune question. Ajoutez-en une pour commencer.</p>
            ) : (
              <ul className="host-list">
                {questions.map((q, index) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      className={`host-list__item${q.id === selectedId ? ' host-list__item--active' : ''}`}
                      onClick={() => setSelectedId(q.id)}
                      aria-current={q.id === selectedId ? 'true' : undefined}
                    >
                      <span className="host-list__index">{index + 1}</span>
                      <span className="host-list__prompt">
                        {q.prompt.trim() || 'Question sans intitulé'}
                      </span>
                      <span className="host-badge">{TYPE_LABEL[q.type]}</span>
                    </button>
                    <div className="host-list__reorder" role="group" aria-label={`Réordonner la question ${index + 1}`}>
                      <button
                        type="button"
                        className="host-list__reorder-btn"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Monter la question ${index + 1}`}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="host-list__reorder-btn"
                        onClick={() => move(index, 1)}
                        disabled={index === questions.length - 1}
                        aria-label={`Descendre la question ${index + 1}`}
                      >
                        ▼
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Button variant="ghost" type="button" onClick={addQuestion}>
                Ajouter une question
              </Button>
            </div>
          </section>

          <section className="host-panel" aria-label="Formulaire de question">
            {!selected ? (
              <p className="ab-empty-state">
                Aucune question sélectionnée. Ajoutez une question pour commencer.
              </p>
            ) : (
              <form className="host-form" onSubmit={(e) => e.preventDefault()}>
                <div className="host-field">
                  <label htmlFor="q-prompt">Intitulé de la question</label>
                  <input
                    id="q-prompt"
                    type="text"
                    value={selected.prompt}
                    onChange={(e) => updateSelected({ prompt: e.target.value })}
                    placeholder="Ex. Quelle planète est surnommée la « planète rouge » ?"
                  />
                </div>

                <div className="host-field-row">
                  <div className="host-field">
                    <label htmlFor="q-type">Type de question</label>
                    <select
                      id="q-type"
                      value={selected.type}
                      onChange={(e) => changeType(e.target.value as QuestionType)}
                    >
                      <option value="mcq">QCM (4 réponses)</option>
                      <option value="truefalse">Vrai / Faux</option>
                      <option value="text">Réponse libre</option>
                      <option value="slider">Curseur</option>
                    </select>
                  </div>
                  <div className="host-field">
                    <label htmlFor="q-duration">Durée (secondes)</label>
                    <input
                      id="q-duration"
                      type="number"
                      min={5}
                      max={120}
                      value={selected.durationSeconds}
                      onChange={(e) => updateSelected({ durationSeconds: Number(e.target.value) })}
                    />
                  </div>
                  <div className="host-field">
                    <label htmlFor="q-points">Points</label>
                    <input
                      id="q-points"
                      type="number"
                      min={0}
                      step={100}
                      value={selected.points}
                      onChange={(e) => updateSelected({ points: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {selected.type === 'mcq' && (
                  <fieldset className="host-field">
                    <legend>Réponses (cochez la bonne réponse)</legend>
                    <div className="host-options-grid">
                      {selected.options.map((opt, index) => (
                        <div className="host-option-row" key={opt.id}>
                          <label className="host-option-row__correct-label">
                            <input
                              type="radio"
                              name="mcq-correct"
                              checked={opt.correct}
                              onChange={() => {
                                const options = selected.options.map((o, i) => ({
                                  ...o,
                                  correct: i === index,
                                }))
                                updateSelected({ options } as Partial<McqQuestion>)
                              }}
                            />
                            <span className="visually-hidden">
                              Marquer « {opt.label || `réponse ${index + 1}`} » comme correcte
                            </span>
                            <span aria-hidden="true">Correcte</span>
                          </label>
                          <AnswerShape shape={opt.shape} size={20} />
                          <label htmlFor={`mcq-label-${opt.id}`} className="visually-hidden">
                            Libellé réponse {index + 1}
                          </label>
                          <input
                            id={`mcq-label-${opt.id}`}
                            type="text"
                            value={opt.label}
                            placeholder={`Réponse ${index + 1}`}
                            onChange={(e) => {
                              const options = selected.options.map((o, i) =>
                                i === index ? { ...o, label: e.target.value } : o,
                              )
                              updateSelected({ options } as Partial<McqQuestion>)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </fieldset>
                )}

                {selected.type === 'truefalse' && (
                  <fieldset className="host-field">
                    <legend>Bonne réponse</legend>
                    <div className="host-truefalse">
                      <label>
                        <input
                          type="radio"
                          name="truefalse"
                          checked={selected.correctAnswer === true}
                          onChange={() => updateSelected({ correctAnswer: true })}
                        />
                        Vrai
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="truefalse"
                          checked={selected.correctAnswer === false}
                          onChange={() => updateSelected({ correctAnswer: false })}
                        />
                        Faux
                      </label>
                    </div>
                  </fieldset>
                )}

                {selected.type === 'text' && (
                  <div className="host-field">
                    <label htmlFor="q-text-answer">Réponse acceptée</label>
                    <input
                      id="q-text-answer"
                      type="text"
                      value={selected.acceptedAnswers[0] ?? ''}
                      onChange={(e) => updateSelected({ acceptedAnswers: [e.target.value] })}
                      placeholder="Ex. Reykjavik"
                    />
                  </div>
                )}

                {selected.type === 'slider' && (
                  <div className="host-field-row">
                    <div className="host-field">
                      <label htmlFor="q-slider-min">Minimum</label>
                      <input
                        id="q-slider-min"
                        type="number"
                        value={selected.min}
                        onChange={(e) => updateSelected({ min: Number(e.target.value) })}
                      />
                    </div>
                    <div className="host-field">
                      <label htmlFor="q-slider-max">Maximum</label>
                      <input
                        id="q-slider-max"
                        type="number"
                        value={selected.max}
                        onChange={(e) => updateSelected({ max: Number(e.target.value) })}
                      />
                    </div>
                    <div className="host-field">
                      <label htmlFor="q-slider-correct">Valeur correcte</label>
                      <input
                        id="q-slider-correct"
                        type="number"
                        value={selected.correctValue}
                        onChange={(e) => updateSelected({ correctValue: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                )}

                <div className="host-actions">
                  <Button variant="danger" type="button" onClick={() => removeQuestion(selected.id)}>
                    Supprimer la question
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
