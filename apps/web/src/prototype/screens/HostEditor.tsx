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
  // Number fields yield NaN when cleared; reject NaN and out-of-range values so
  // an invalid duration can never reach the timer, nor an invalid launch.
  if (!Number.isInteger(q.durationSeconds) || q.durationSeconds < 5 || q.durationSeconds > 120)
    return 'Durée entre 5 et 120 s.'
  if (!Number.isInteger(q.points) || q.points < 0) return 'Points positifs requis.'
  switch (q.type) {
    case 'mcq': {
      if (q.options.some((o) => o.label.trim().length === 0))
        return 'Chaque réponse doit avoir un libellé.'
      if (!q.options.some((o) => o.correct)) return 'Choisissez la bonne réponse.'
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

/**
 * Field-level validation, keyed by the offending input's DOM id, so each
 * invalid control can carry aria-invalid + aria-describedby (like Join.tsx).
 * The aggregate validationError() still drives the live status summary.
 */
function fieldErrors(q: Question): Record<string, string> {
  const errs: Record<string, string> = {}
  if (q.prompt.trim().length === 0) errs['q-prompt'] = 'Intitulé manquant.'
  if (!Number.isInteger(q.durationSeconds) || q.durationSeconds < 5 || q.durationSeconds > 120)
    errs['q-duration'] = 'Durée entre 5 et 120 s.'
  if (!Number.isInteger(q.points) || q.points < 0) errs['q-points'] = 'Points positifs requis.'
  switch (q.type) {
    case 'mcq':
      q.options.forEach((o, i) => {
        if (o.label.trim().length === 0)
          errs[`mcq-label-${o.id}`] = `Réponse ${i + 1} : libellé manquant.`
      })
      if (!q.options.some((o) => o.correct)) errs['mcq-correct'] = 'Choisissez la bonne réponse.'
      break
    case 'text':
      if (!q.acceptedAnswers.some((a) => a.trim().length > 0))
        errs['text-answer-0'] = 'Ajoutez au moins une réponse acceptée.'
      break
    case 'slider':
      if (q.min >= q.max) {
        errs['q-slider-min'] = 'Le minimum doit être inférieur au maximum.'
        errs['q-slider-max'] = 'Le minimum doit être inférieur au maximum.'
      }
      if (q.correctValue < q.min || q.correctValue > q.max)
        errs['q-slider-correct'] =
          'La valeur correcte doit être comprise entre le minimum et le maximum.'
      break
    case 'truefalse':
      break
  }
  return errs
}

export function HostEditor() {
  const [title, setTitle] = useState(mockQuiz.title)
  const [description, setDescription] = useState(mockQuiz.description)
  const [questions, setQuestions] = useState<Question[]>(mockQuiz.questions)
  const [selectedId, setSelectedId] = useState<string | null>(mockQuiz.questions[0]?.id ?? null)
  const [announcement, setAnnouncement] = useState('')
  // In-app replacements for window.confirm: a destructive type-change dialog
  // and an undo affordance for deletion.
  const [pendingType, setPendingType] = useState<QuestionType | null>(null)
  const [lastDeleted, setLastDeleted] = useState<{ question: Question; index: number } | null>(null)
  // Confirmation shown after a valid « Lancer la partie » click (demo).
  const [launchMessage, setLaunchMessage] = useState<string | null>(null)

  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const addRef = useRef<HTMLButtonElement>(null)
  const typeSelectRef = useRef<HTMLSelectElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const dialogConfirmRef = useRef<HTMLButtonElement>(null)
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

  // Focus the dialog's primary action when it opens (focus trap in JSX below).
  useEffect(() => {
    if (pendingType) dialogConfirmRef.current?.focus()
  }, [pendingType])

  const selectedIndex = questions.findIndex((q) => q.id === selectedId)
  const selected = selectedIndex >= 0 ? questions[selectedIndex] : null
  const fErrors = selected ? fieldErrors(selected) : {}

  const invalidCount = questions.filter((q) => validationError(q) !== null).length
  const launchReason =
    questions.length === 0
      ? 'Ajoutez au moins une question pour lancer la partie.'
      : invalidCount > 0
        ? `${invalidCount} question${invalidCount > 1 ? 's' : ''} à compléter avant de lancer la partie.`
        : null
  const canLaunch = launchReason === null

  function updateSelected(patch: Partial<Question>) {
    if (!selected) return
    setQuestions((prev) =>
      prev.map((q) => (q.id === selected.id ? ({ ...q, ...patch } as Question) : q)),
    )
  }

  function applyTypeChange(type: QuestionType) {
    if (!selected) return
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

  function changeType(type: QuestionType) {
    if (!selected) return
    if (type === selected.type) return
    // Destructive change: confirm via an in-app dialog (no native confirm()).
    if (hasTypeSpecificData(selected)) {
      setPendingType(type)
      return
    }
    applyTypeChange(type)
  }

  function confirmTypeChange() {
    if (pendingType) applyTypeChange(pendingType)
    setPendingType(null)
    typeSelectRef.current?.focus()
  }

  function cancelTypeChange() {
    setPendingType(null)
    typeSelectRef.current?.focus()
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
    const removed = questions[index]
    // Immediate, non-blocking removal + an « Annuler » affordance (no native
    // confirm dialog). The undo banner restores the question at its position.
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
    setLastDeleted({ question: removed, index })
    setAnnouncement('Question supprimée. Utilisez « Annuler » pour la restaurer.')
  }

  function undoDelete() {
    if (!lastDeleted) return
    const { question: q, index } = lastDeleted
    // The « Annuler » button holding focus is about to be unmounted; without a
    // refocus target, focus falls to <body> (WCAG 2.4.3). Steer the shared
    // [questions] effect to the restored item, exactly like removeQuestion().
    pendingFocus.current = { kind: 'item', id: q.id }
    setQuestions((prev) => {
      const next = [...prev]
      next.splice(Math.min(index, next.length), 0, q)
      return next
    })
    setSelectedId(q.id)
    setLastDeleted(null)
    setAnnouncement('Question restaurée.')
  }

  return (
    <div className="ab-shell">
      <header className="ab-shell__header" aria-hidden={pendingType ? true : undefined}>
        <Logo />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Visible brand/positioning line — carries the dual-mode promise on a
              host surface, and replaces the SR-only title that duplicated the
              <h1>Éditeur de quiz</h1> in <main>. */}
          <p className="host-brandline">
            <strong>Arena</strong> — quiz en direct, open-source · chez vous ou dans le cloud
          </p>
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>{title}</span>
        </div>
        <div className="host-launch">
          <Button
            variant="primary"
            type="button"
            aria-disabled={!canLaunch}
            aria-describedby={!canLaunch ? 'host-launch-reason' : undefined}
            onClick={(e) => {
              if (!canLaunch) {
                e.preventDefault()
                return
              }
              setLaunchMessage(
                'Partie prête — un code PIN 482913 serait généré (démonstration).',
              )
            }}
          >
            Lancer la partie
          </Button>
          {canLaunch ? (
            <p className="host-launch__hint">
              Un code PIN sera généré ; partagez-le pour que la salle rejoigne.
            </p>
          ) : (
            // Anchor the blocking reason directly under the button (not only in
            // the banner far down in <main>).
            <p className="host-launch__hint">{launchReason}</p>
          )}
          {launchMessage && (
            <p className="host-launch__confirm" role="status">
              {launchMessage}
            </p>
          )}
        </div>
      </header>

      <main
        className="ab-shell__main"
        id="contenu-principal"
        tabIndex={-1}
        aria-hidden={pendingType ? true : undefined}
      >
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

        {launchReason && (
          <p className="host-launch__warning" role="status" id="host-launch-reason">
            {launchReason}
          </p>
        )}

        {lastDeleted && (
          // Visual affordance only — the deletion announcement is carried once
          // by the dedicated visually-hidden status region below.
          <div className="host-undo">
            <span>Question supprimée.</span>
            <Button variant="ghost" type="button" onClick={undoDelete}>
              Annuler
            </Button>
          </div>
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
                          <span
                            className="host-badge host-badge--warn"
                            title={error}
                            aria-label={`Incomplète : ${error}`}
                          >
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
                    aria-invalid={fErrors['q-prompt'] ? true : undefined}
                    aria-describedby={fErrors['q-prompt'] ? 'q-prompt-error' : undefined}
                  />
                  {fErrors['q-prompt'] && (
                    <p className="host-inline-error" id="q-prompt-error">
                      {fErrors['q-prompt']}
                    </p>
                  )}
                </div>

                <div className="host-field-row">
                  <div className="host-field">
                    <label htmlFor="q-type">Type de question</label>
                    <select
                      id="q-type"
                      ref={typeSelectRef}
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
                      aria-invalid={fErrors['q-duration'] ? true : undefined}
                      aria-describedby={fErrors['q-duration'] ? 'q-duration-error' : undefined}
                    />
                    {fErrors['q-duration'] && (
                      <p className="host-inline-error" id="q-duration-error">
                        {fErrors['q-duration']}
                      </p>
                    )}
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
                      aria-invalid={fErrors['q-points'] ? true : undefined}
                      aria-describedby={fErrors['q-points'] ? 'q-points-error' : undefined}
                    />
                    {fErrors['q-points'] && (
                      <p className="host-inline-error" id="q-points-error">
                        {fErrors['q-points']}
                      </p>
                    )}
                  </div>
                </div>

                {selected.type === 'mcq' && (
                  <fieldset className="host-field">
                    <legend>Réponses (cochez la bonne réponse)</legend>
                    {fErrors['mcq-correct'] && (
                      <p className="host-inline-error" id="mcq-correct-error">
                        {fErrors['mcq-correct']}
                      </p>
                    )}
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
                            aria-invalid={fErrors[`mcq-label-${opt.id}`] ? true : undefined}
                            aria-describedby={
                              fErrors[`mcq-label-${opt.id}`]
                                ? `mcq-label-${opt.id}-error`
                                : undefined
                            }
                          />
                          {fErrors[`mcq-label-${opt.id}`] && (
                            <p className="host-inline-error" id={`mcq-label-${opt.id}-error`}>
                              {fErrors[`mcq-label-${opt.id}`]}
                            </p>
                          )}
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
                            aria-invalid={fErrors[`text-answer-${index}`] ? true : undefined}
                            aria-describedby={
                              fErrors[`text-answer-${index}`]
                                ? `text-answer-${index}-error`
                                : undefined
                            }
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
                          {fErrors[`text-answer-${index}`] && (
                            <p className="host-inline-error" id={`text-answer-${index}-error`}>
                              {fErrors[`text-answer-${index}`]}
                            </p>
                          )}
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
                        aria-invalid={fErrors['q-slider-min'] ? true : undefined}
                        aria-describedby={fErrors['q-slider-min'] ? 'q-slider-min-error' : undefined}
                      />
                      {fErrors['q-slider-min'] && (
                        <p className="host-inline-error" id="q-slider-min-error">
                          {fErrors['q-slider-min']}
                        </p>
                      )}
                    </div>
                    <div className="host-field">
                      <label htmlFor="q-slider-max">Maximum</label>
                      <input
                        id="q-slider-max"
                        type="number"
                        value={selected.max}
                        onChange={(e) => updateSelected({ max: Number(e.target.value) })}
                        aria-invalid={fErrors['q-slider-max'] ? true : undefined}
                        aria-describedby={fErrors['q-slider-max'] ? 'q-slider-max-error' : undefined}
                      />
                      {fErrors['q-slider-max'] && (
                        <p className="host-inline-error" id="q-slider-max-error">
                          {fErrors['q-slider-max']}
                        </p>
                      )}
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
                        aria-invalid={fErrors['q-slider-correct'] ? true : undefined}
                        aria-describedby={
                          fErrors['q-slider-correct'] ? 'q-slider-correct-error' : undefined
                        }
                      />
                      {fErrors['q-slider-correct'] && (
                        <p className="host-inline-error" id="q-slider-correct-error">
                          {fErrors['q-slider-correct']}
                        </p>
                      )}
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

      {pendingType && (
        <div className="host-dialog__backdrop">
          <div
            className="host-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-dialog-title"
            aria-describedby="host-dialog-desc"
            ref={dialogRef}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelTypeChange()
                return
              }
              if (e.key !== 'Tab') return
              const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button')
              if (!nodes || nodes.length === 0) return
              const first = nodes[0]
              const last = nodes[nodes.length - 1]
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
              }
            }}
          >
            <h2 id="host-dialog-title">Changer le type de question ?</h2>
            <p id="host-dialog-desc" style={{ color: 'var(--ink-dim)' }}>
              Les réponses saisies pour cette question seront effacées. Le reste (intitulé,
              durée, points) est conservé.
            </p>
            <div className="host-dialog__actions">
              <Button variant="ghost" type="button" onClick={cancelTypeChange}>
                Annuler
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={confirmTypeChange}
                ref={dialogConfirmRef}
              >
                Changer de type
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
