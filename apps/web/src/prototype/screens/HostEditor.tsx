import { useEffect, useRef, useState } from 'react'
import type { AnswerShapeKind, McqQuestion, Question, QuestionType, TextQuestion } from '../mockData'
import { mockQuiz } from '../mockData'
import { AnswerShape, Button, Logo, SHAPE_NAME_FR } from '../ui'

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

/** True when a question carries type-specific data that changing type would wipe. */
function hasTypeSpecificData(q: Question): boolean {
  switch (q.type) {
    case 'mcq':
      return q.options.some((o) => o.label.trim().length > 0)
    case 'text':
      return q.acceptedAnswers.some((a) => a.trim().length > 0)
    case 'truefalse':
    case 'slider':
      return false
  }
}

/** Returns a human reason string when the question is incomplete, else null. */
function validationError(q: Question): string | null {
  if (q.prompt.trim().length === 0) return 'Intitulé manquant.'
  switch (q.type) {
    case 'mcq': {
      if (q.options.some((o) => o.label.trim().length === 0))
        return 'Chaque réponse doit avoir un libellé.'
      if (!q.options.some((o) => o.correct)) return 'Cochez au moins une bonne réponse.'
      return null
    }
    case 'text':
      return q.acceptedAnswers.some((a) => a.trim().length > 0)
        ? null
        : 'Ajoutez au moins une réponse acceptée.'
    case 'slider':
      if (q.min >= q.max) return 'Le minimum doit être inférieur au maximum.'
      if (q.correctValue < q.min || q.correctValue > q.max)
        return 'La valeur correcte doit être comprise entre le minimum et le maximum.'
      return null
    case 'truefalse':
      return null
  }
}

export function HostEditor() {
  const [title, setTitle] = useState(mockQuiz.title)
  const [description, setDescription] = useState(mockQuiz.description)
  const [questions, setQuestions] = useState<Question[]>(mockQuiz.questions)
  const [selectedId, setSelectedId] = useState<string | null>(mockQuiz.questions[0]?.id ?? null)
  const [announcement, setAnnouncement] = useState('')

  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const addRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<{ kind: 'item'; id: string } | { kind: 'add' } | null>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target.kind === 'add') {
      addRef.current?.focus()
    } else {
      itemRefs.current.get(target.id)?.focus()
    }
  }, [questions])

  const selectedIndex = questions.findIndex((q) => q.id === selectedId)
  const selected = selectedIndex >= 0 ? questions[selectedIndex] : null

  const invalidCount = questions.filter((q) => validationError(q) !== null).length
  const canLaunch = questions.length > 0 && invalidCount === 0

  function updateSelected(patch: Partial<Question>) {
    if (!selected) return
    setQuestions((prev) =>
      prev.map((q) => (q.id === selected.id ? ({ ...q, ...patch } as Question) : q)),
    )
  }

  function changeType(type: QuestionType) {
    if (!selected) return
    if (type === selected.type) return
    if (hasTypeSpecificData(selected)) {
      const ok = window.confirm(
        'Changer de type effacera les réponses de cette question. Continuer ?',
      )
      if (!ok) return
    }
    const draft = createDefaultQuestion(type)
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === selected.id
          ? {
              ...draft,
              id: q.id,
              prompt: q.prompt,
              durationSeconds: q.durationSeconds,
              points: q.points,
            }
          : q,
      ),
    )
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const moved = questions[index]
    setQuestions((prev) => {
      const next = [...prev]
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
    // Keep focus on the item that moved, at its new position.
    pendingFocus.current = { kind: 'item', id: moved.id }
    setAnnouncement(`Question déplacée en position ${target + 1}.`)
  }

  function addQuestion() {
    const draft = createDefaultQuestion('mcq')
    setQuestions((prev) => [...prev, draft])
    setSelectedId(draft.id)
    setAnnouncement('Question ajoutée.')
  }

  function removeQuestion(id: string) {
    const index = questions.findIndex((q) => q.id === id)
    if (index < 0) return
    const ok = window.confirm('Supprimer cette question ? Cette action est définitive.')
    if (!ok) return
    setQuestions((prev) => {
      const next = prev.filter((q) => q.id !== id)
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null)
      }
      // Move focus to a neighbour item, or the "Add" button if the list empties.
      const neighbour = next[index] ?? next[index - 1]
      pendingFocus.current = neighbour ? { kind: 'item', id: neighbour.id } : { kind: 'add' }
      return next
    })
    setAnnouncement('Question supprimée.')
  }

  return (
    <div className="ab-shell">
      <header className="ab-shell__header">
        <Logo />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="visually-hidden">Éditeur de quiz</p>
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>{title}</span>
        </div>
        <div className="host-launch">
          <Button variant="primary" type="button" disabled={!canLaunch}>
            Lancer la partie
          </Button>
          <p className="host-launch__hint">
            Un code PIN sera généré ; partagez-le pour que la salle rejoigne.
          </p>
        </div>
      </header>

      <main className="ab-shell__main">
        <h1 style={{ marginBottom: 'var(--space-4)' }}>Éditeur de quiz</h1>

        <div className="host-meta">
          <div className="host-field">
            <label htmlFor="quiz-title">Titre du quiz</label>
            <input
              id="quiz-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Culture générale — spécial vendredi"
            />
          </div>
          <div className="host-field">
            <label htmlFor="quiz-description">Description</label>
            <textarea
              id="quiz-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Une phrase pour situer le quiz."
            />
          </div>
        </div>

        {invalidCount > 0 && (
          <p className="host-launch__warning" role="status">
            {invalidCount} question{invalidCount > 1 ? 's' : ''} à compléter avant de lancer la partie.
          </p>
        )}

        <div className="host-layout">
          <section aria-label="Liste des questions">
            <h2 style={{ marginBottom: 'var(--space-3)' }}>Questions</h2>
            {questions.length === 0 ? (
              <p className="ab-empty-state">Aucune question. Ajoutez-en une pour commencer.</p>
            ) : (
              <ul className="host-list">
                {questions.map((q, index) => {
                  const error = validationError(q)
                  return (
                    <li key={q.id}>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) itemRefs.current.set(q.id, el)
                          else itemRefs.current.delete(q.id)
                        }}
                        className={`host-list__item${q.id === selectedId ? ' host-list__item--active' : ''}`}
                        onClick={() => setSelectedId(q.id)}
                        aria-current={q.id === selectedId ? 'true' : undefined}
                      >
                        <span className="host-list__index">{index + 1}</span>
                        <span className="host-list__prompt">
                          {q.prompt.trim() || 'Question sans intitulé'}
                        </span>
                        {error && (
                          <span className="host-badge host-badge--warn" title={error}>
                            Incomplète
                          </span>
                        )}
                        <span className="host-badge">{TYPE_LABEL[q.type]}</span>
                      </button>
                      <div
                        className="host-list__reorder"
                        role="group"
                        aria-label={`Réordonner la question ${index + 1}`}
                      >
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
                  )
                })}
              </ul>
            )}
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Button variant="ghost" type="button" onClick={addQuestion} ref={addRef}>
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
                {(() => {
                  const error = validationError(selected)
                  return error ? (
                    <p className="host-field-error" role="status">
                      À corriger : {error}
                    </p>
                  ) : null
                })()}

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
                            Libellé réponse {index + 1} — {SHAPE_NAME_FR[opt.shape]}
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
                  <fieldset className="host-field">
                    <legend>Réponses acceptées</legend>
                    <p className="host-field__help">Casse et accents ignorés.</p>
                    <div className="host-variants">
                      {selected.acceptedAnswers.map((answer, index) => (
                        <div className="host-variant-row" key={index}>
                          <label htmlFor={`text-answer-${index}`} className="visually-hidden">
                            Variante {index + 1}
                          </label>
                          <input
                            id={`text-answer-${index}`}
                            type="text"
                            value={answer}
                            placeholder="Ex. Reykjavik"
                            onChange={(e) => {
                              const acceptedAnswers = selected.acceptedAnswers.map((a, i) =>
                                i === index ? e.target.value : a,
                              )
                              updateSelected({ acceptedAnswers } as Partial<TextQuestion>)
                            }}
                          />
                          <button
                            type="button"
                            className="host-variant-remove"
                            aria-label={`Supprimer la variante ${index + 1}`}
                            disabled={selected.acceptedAnswers.length <= 1}
                            onClick={() => {
                              const acceptedAnswers = selected.acceptedAnswers.filter(
                                (_, i) => i !== index,
                              )
                              updateSelected({ acceptedAnswers } as Partial<TextQuestion>)
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() =>
                          updateSelected({
                            acceptedAnswers: [...selected.acceptedAnswers, ''],
                          } as Partial<TextQuestion>)
                        }
                      >
                        Ajouter une variante
                      </Button>
                    </div>
                  </fieldset>
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
                      <label htmlFor="q-slider-step">Pas (step)</label>
                      <input
                        id="q-slider-step"
                        type="number"
                        min={1}
                        value={selected.step}
                        onChange={(e) => updateSelected({ step: Number(e.target.value) })}
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

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
