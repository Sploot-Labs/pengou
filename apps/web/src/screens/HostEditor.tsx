import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import {
  createQuestion,
  createQuiz,
  deleteQuestion,
  listQuestions,
  listQuizzes,
  reorderQuestions,
  updateQuestion,
  updateQuiz,
  type CreateQuestionInput,
  type Question as ApiQuestion,
  type QuestionType,
  type Quiz,
  type UpdateQuestionInput,
} from '../api/quizzes'
import { AnswerShape, Button, Logo, SHAPE_NAME_FR } from '../ui'

/**
 * HostEditor — wired to the real quiz/question REST API (Plan 06 Task 3).
 * Previously driven by `mockData.ts`'s single hardcoded `mockQuiz`; now loads
 * the signed-in host's quizzes, lets them pick/create one, and persists every
 * edit through `src/api/quizzes.ts`. See the module comments below for the
 * three deliberate adaptations forced by the real API's shape (no `points`
 * field, immutable question `type`, permanent deletion) — the plan explicitly
 * allows "adapt minimally, don't redesign" for exactly this situation.
 */

const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'QCM',
  truefalse: 'Vrai / Faux',
  text: 'Réponse libre',
  slider: 'Curseur',
}

/** Decorative only (color + glyph reinforcing the shape cue on mcq tiles) —
 * never persisted. Structurally identical to `AnswerShapeKind` in `ui.tsx`
 * (which still imports its name from `mockData.ts` for the *other* prototype
 * screens not yet wired); re-declared locally instead of importing from
 * `mockData` so this screen carries zero mock imports, per Task 3's
 * self-review checklist. TS matches these by structural (literal-union)
 * shape, not by declaration identity, so this is safe. */
type ShapeKind = 'triangle' | 'diamond' | 'circle' | 'square'
const MCQ_SHAPES: ShapeKind[] = ['triangle', 'diamond', 'circle', 'square']

/* ------------------------------------------------------------------ */
/* Local editable question model                                        */
/* ------------------------------------------------------------------ */
/**
 * The server's `Question` row (`api/quizzes.ts`) carries `payload` as an
 * opaque per-type blob. The editor form needs it flattened into concrete
 * fields (and, for mcq, a client-only `shape` per option) — this is that
 * flattened shape, converted to/from the API row by `fromApiQuestion` /
 * `toQuestionPatch` / `toCreateInput` below.
 *
 * NOTE — no `points` field: the prototype's mock model had one, but the real
 * `question` table/API has no `points`/`basePoints` column at all (scoring's
 * base value isn't per-question-configurable yet). Rather than fake a field
 * that silently wouldn't persist, it's dropped from the editor entirely. If
 * a later plan adds it server-side, this is where it comes back.
 */
interface QuestionBase {
  id: string
  type: QuestionType
  prompt: string
  timeLimit: number
}
interface McqOption {
  id: string
  shape: ShapeKind
  label: string
  correct: boolean
}
export interface McqQuestion extends QuestionBase {
  type: 'mcq'
  options: McqOption[]
}
export interface TrueFalseQuestion extends QuestionBase {
  type: 'truefalse'
  correctAnswer: boolean
}
export interface TextQuestion extends QuestionBase {
  type: 'text'
  acceptedAnswers: string[]
}
export interface SliderQuestion extends QuestionBase {
  type: 'slider'
  min: number
  max: number
  step: number
  correctValue: number
}
export type Question = McqQuestion | TrueFalseQuestion | TextQuestion | SliderQuestion

function fromApiQuestion(row: ApiQuestion): Question {
  const base = { id: row.id, prompt: row.prompt, timeLimit: row.timeLimit }
  switch (row.type) {
    case 'mcq': {
      const payload = row.payload as { options: { label: string; correct: boolean }[] }
      return {
        ...base,
        type: 'mcq',
        options: payload.options.map((o, i) => ({
          id: `opt-${i}`,
          shape: MCQ_SHAPES[i % MCQ_SHAPES.length],
          label: o.label,
          correct: o.correct,
        })),
      }
    }
    case 'truefalse': {
      const payload = row.payload as { correct: boolean }
      return { ...base, type: 'truefalse', correctAnswer: payload.correct }
    }
    case 'text': {
      const payload = row.payload as { answers: string[]; caseSensitive?: boolean }
      return { ...base, type: 'text', acceptedAnswers: payload.answers.length > 0 ? payload.answers : [''] }
    }
    case 'slider': {
      const payload = row.payload as { min: number; max: number; correct: number; step?: number }
      return {
        ...base,
        type: 'slider',
        min: payload.min,
        max: payload.max,
        step: payload.step ?? 1,
        correctValue: payload.correct,
      }
    }
  }
}

/** Builds the PATCH body for an existing question. Text answers are trimmed
 * and blank rows filtered out before sending: the local UI tolerates a blank
 * "in progress" variant row (so typing a new one doesn't need to start
 * non-empty), but the server's schema requires every entry in `answers` to
 * be non-empty — sending a blank one would 400 the whole payload even though
 * the already-filled variants are fine. */
function toQuestionPatch(q: Question): UpdateQuestionInput {
  switch (q.type) {
    case 'mcq':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        payload: { options: q.options.map((o) => ({ label: o.label, correct: o.correct })) },
      }
    case 'truefalse':
      return { prompt: q.prompt, timeLimit: q.timeLimit, payload: { correct: q.correctAnswer } }
    case 'text':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        payload: {
          answers: q.acceptedAnswers.map((a) => a.trim()).filter((a) => a.length > 0),
          caseSensitive: false,
        },
      }
    case 'slider':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        payload: { min: q.min, max: q.max, correct: q.correctValue, step: q.step > 0 ? q.step : undefined },
      }
  }
}

function toCreateInput(q: Question): CreateQuestionInput {
  return { type: q.type, ...toQuestionPatch(q) } as CreateQuestionInput
}

/** Valid-by-construction defaults for a brand-new question of `type`. Unlike
 * the prototype's mock defaults (deliberately blank, to force the host to
 * fill them in before "Incomplete" clears), these MUST already satisfy the
 * server's per-type zod schema: `POST .../questions` validates the payload
 * immediately, there is no server-side concept of an unsaved draft. A
 * side-effect: a freshly added question no longer shows the "Incomplete"
 * badge (its placeholder content already passes validation) — documented
 * trade-off, not a bug. */
function defaultCreateInput(type: QuestionType): CreateQuestionInput {
  const prompt = 'Nouvelle question'
  const timeLimit = 20
  switch (type) {
    case 'mcq':
      return {
        type,
        prompt,
        timeLimit,
        payload: {
          options: [
            { label: 'Réponse 1', correct: true },
            { label: 'Réponse 2', correct: false },
            { label: 'Réponse 3', correct: false },
            { label: 'Réponse 4', correct: false },
          ],
        },
      }
    case 'truefalse':
      return { type, prompt, timeLimit, payload: { correct: true } }
    case 'text':
      return { type, prompt, timeLimit, payload: { answers: ['Réponse'], caseSensitive: false } }
    case 'slider':
      return { type, prompt, timeLimit, payload: { min: 0, max: 100, correct: 50, step: 1 } }
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
  // an invalid duration can never reach the timer, nor an invalid launch. The
  // server itself only requires a positive integer — [5, 120] is a client-side
  // product guardrail, kept from the prototype.
  if (!Number.isInteger(q.timeLimit) || q.timeLimit < 5 || q.timeLimit > 120)
    return 'Durée entre 5 et 120 s.'
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
      if (!(q.step > 0)) return 'Le pas doit être positif.'
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
  if (!Number.isInteger(q.timeLimit) || q.timeLimit < 5 || q.timeLimit > 120)
    errs['q-duration'] = 'Durée entre 5 et 120 s.'
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
      if (!(q.step > 0)) errs['q-slider-step'] = 'Le pas doit être positif.'
      break
    case 'truefalse':
      break
  }
  return errs
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur réseau est survenue. Réessayez.'
}

const LAST_QUIZ_KEY = 'arena.hostEditor.lastQuizId'

export function HostEditor() {
  // --- Quiz list + selection --------------------------------------------
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [quizzesLoading, setQuizzesLoading] = useState(true)
  const [quizzesError, setQuizzesError] = useState<string | null>(null)
  const [currentQuizId, setCurrentQuizId] = useState<string | null>(null)

  const [creatingQuiz, setCreatingQuiz] = useState(false)
  const [newQuizTitle, setNewQuizTitle] = useState('')
  const [newQuizError, setNewQuizError] = useState<string | null>(null)
  const [newQuizPending, setNewQuizPending] = useState(false)
  const newQuizTitleRef = useRef<HTMLInputElement>(null)
  const quizPickerRef = useRef<HTMLSelectElement>(null)

  // --- Selected quiz's editable fields (title/description) ---------------
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)

  // --- Questions for the selected quiz ------------------------------------
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Surfaces the server's own message on a failed mutation (create/update/
  // delete/reorder/type-change) — the client-side checks above are for UX,
  // the server is the source of truth for validation (Task 3 requirement).
  const [actionError, setActionError] = useState<string | null>(null)
  // In-app replacements for window.confirm: a destructive type-change dialog
  // and an undo affordance for deletion.
  const [pendingType, setPendingType] = useState<QuestionType | null>(null)
  const [lastDeleted, setLastDeleted] = useState<{ question: Question; index: number } | null>(null)

  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const addRef = useRef<HTMLButtonElement>(null)
  const typeSelectRef = useRef<HTMLSelectElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const dialogConfirmRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<{ kind: 'item'; id: string } | { kind: 'add' } | null>(null)

  // Debounced autosave: tracks, per question id, the JSON of the patch last
  // successfully persisted, so (a) freshly loaded/created questions don't
  // trigger a no-op PATCH, and (b) unrelated re-renders don't re-save
  // unchanged content.
  const lastSavedRef = useRef<Map<string, string>>(new Map())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function primeSaved(q: Question) {
    lastSavedRef.current.set(q.id, JSON.stringify(toQuestionPatch(q)))
  }

  /* ---------------------------------------------------------------- */
  /* Load the host's quizzes on mount                                    */
  /* ---------------------------------------------------------------- */
  function loadQuizzes() {
    setQuizzesLoading(true)
    setQuizzesError(null)
    listQuizzes()
      .then((rows) => {
        setQuizzes(rows)
        setQuizzesLoading(false)
        if (rows.length > 0) {
          const remembered = localStorage.getItem(LAST_QUIZ_KEY)
          const initial = rows.find((q) => q.id === remembered) ?? rows[0]
          setCurrentQuizId(initial.id)
        }
      })
      .catch((err) => {
        setQuizzesLoading(false)
        setQuizzesError(errorMessage(err))
      })
  }

  useEffect(() => {
    loadQuizzes()
    // Runs once on mount; loadQuizzes is a stable module-scope-free closure
    // recreated each render, but re-running it isn't desired on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the title/description fields in sync when the selected quiz changes
  // (switching quizzes, or the freshly created one becoming current).
  useEffect(() => {
    const q = quizzes.find((x) => x.id === currentQuizId)
    if (q) {
      setTitle(q.title)
      setDescription(q.description ?? '')
      setTitleError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuizId])

  /* ---------------------------------------------------------------- */
  /* Load the selected quiz's questions                                  */
  /* ---------------------------------------------------------------- */
  function loadQuestions(quizId: string) {
    setQuestionsLoading(true)
    setQuestionsError(null)
    listQuestions(quizId)
      .then((rows) => {
        const mapped = rows.map(fromApiQuestion)
        mapped.forEach(primeSaved)
        setQuestions(mapped)
        // Preserve the current selection across a reload when it still
        // exists in the reloaded list — this function doubles as a
        // failure-resync (type change, undo), and unconditionally jumping to
        // the first question there would silently steal the host's place
        // with no explanation. Only fall back to the first question when the
        // previously selected one is genuinely gone (or on the very first
        // load, where `prev` is null).
        setSelectedId((prev) => (prev && mapped.some((q) => q.id === prev) ? prev : (mapped[0]?.id ?? null)))
        setQuestionsLoading(false)
      })
      .catch((err) => {
        setQuestionsLoading(false)
        setQuestionsError(errorMessage(err))
      })
  }

  useEffect(() => {
    if (!currentQuizId) {
      setQuestions([])
      setSelectedId(null)
      return
    }
    loadQuestions(currentQuizId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuizId])

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

  // Focus the revealed title field when "Nouveau quiz" is opened, so keyboard
  // users land directly in the input instead of having to tab past the form.
  useEffect(() => {
    if (creatingQuiz) newQuizTitleRef.current?.focus()
  }, [creatingQuiz])

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

  // Debounced autosave for the currently selected question: fires 600ms
  // after the last edit, only when the draft passes client-side validation
  // (an invalid draft is never sent — the "Incomplete" state stays local
  // until fixed) and only when it actually differs from what was last
  // persisted (see lastSavedRef above).
  useEffect(() => {
    if (!selected || !currentQuizId) return
    if (validationError(selected)) return
    const patch = toQuestionPatch(selected)
    const key = JSON.stringify(patch)
    if (lastSavedRef.current.get(selected.id) === key) return
    const quizId = currentQuizId
    const id = selected.id
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      updateQuestion(quizId, id, patch)
        .then(() => {
          lastSavedRef.current.set(id, key)
          setActionError(null)
        })
        .catch((err) => setActionError(errorMessage(err)))
    }, 600)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, currentQuizId])

  function updateSelected(patch: Partial<Question>) {
    if (!selected) return
    setQuestions((prev) =>
      prev.map((q) => (q.id === selected.id ? ({ ...q, ...patch } as Question) : q)),
    )
  }

  /** Applies a new type LOCALLY only — used to build the create-input for the
   * delete+recreate flow in `confirmTypeChange` (see its comment for why a
   * question's type can't simply be PATCHed). */
  function draftForType(type: QuestionType, keep: Question): Question {
    const input = defaultCreateInput(type)
    input.prompt = keep.prompt
    input.timeLimit = keep.timeLimit
    return fromApiQuestion({
      id: keep.id,
      quizId: '',
      type,
      prompt: input.prompt,
      media: null,
      timeLimit: input.timeLimit,
      orderIndex: 0,
      payload: input.payload,
      createdAt: '',
    })
  }

  function changeType(type: QuestionType) {
    if (!selected) return
    if (type === selected.type) return
    // Destructive change: confirm via an in-app dialog (no native confirm()).
    if (hasTypeSpecificData(selected)) {
      setPendingType(type)
      return
    }
    applyTypeChangeImmediate(type)
  }

  /** A question's `type` is IMMUTABLE server-side (see
   * `apps/server/src/routes/questions.ts`'s PATCH handler: it revalidates any
   * `payload` against the STORED type and has no `type` field at all in its
   * accepted patch). The prototype's UI assumed an in-place type change was
   * possible; here it's simulated by deleting the old row and creating a new
   * one of the new type at the same list position (fixed up with an explicit
   * `reorderQuestions` call, since creation always appends at the end). The
   * new row necessarily gets a NEW id — invisible to the host, but worth
   * knowing if you're reading network logs. */
  async function applyTypeChangeImmediate(type: QuestionType) {
    if (!selected || !currentQuizId) return
    const quizId = currentQuizId
    const index = questions.findIndex((q) => q.id === selected.id)
    const draft = draftForType(type, selected)
    try {
      setActionError(null)
      await deleteQuestion(quizId, selected.id)
      const created = await createQuestion(quizId, toCreateInput(draft))
      const next = fromApiQuestion(created)
      primeSaved(next)
      // Computed as a plain local array (like `move()`), NOT captured from
      // inside a `setQuestions` functional-updater callback: React doesn't
      // guarantee that updater runs synchronously before the next line, so
      // reading a closure variable it assigns can still see it unset — which
      // previously sent `reorderQuestions` an EMPTY orderedIds list (still
      // "succeeds" server-side, vacuously, silently leaving the real order
      // wrong). `questions` here is the current render's list, safe to read
      // synchronously since nothing else mutates it between this render and
      // this call.
      const spliced = questions.filter((q) => q.id !== selected.id)
      spliced.splice(Math.min(index, spliced.length), 0, next)
      setQuestions(spliced)
      setSelectedId(next.id)
      await reorderQuestions(
        quizId,
        spliced.map((q) => q.id),
      )
    } catch (err) {
      setActionError(errorMessage(err))
      // Best-effort resync so the list doesn't silently diverge from the
      // server if the delete succeeded but the recreate/reorder didn't.
      loadQuestions(quizId)
    }
  }

  function confirmTypeChange() {
    if (pendingType) void applyTypeChangeImmediate(pendingType)
    setPendingType(null)
    typeSelectRef.current?.focus()
  }

  function cancelTypeChange() {
    setPendingType(null)
    typeSelectRef.current?.focus()
  }

  async function move(index: number, direction: -1 | 1) {
    if (!currentQuizId) return
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const previous = questions
    const moved = previous[index]
    const next = [...previous]
    const tmp = next[index]
    next[index] = next[target]
    next[target] = tmp
    setQuestions(next)
    // Keep focus on the item that moved, at its new position.
    pendingFocus.current = { kind: 'item', id: moved.id }
    try {
      setActionError(null)
      await reorderQuestions(
        currentQuizId,
        next.map((q) => q.id),
      )
      // Announce success only once the server confirms the move — announcing
      // before the await resolves would tell screen-reader users the move
      // succeeded even when it's rolled back a moment later in the catch
      // below (sighted users would see the list revert while SR users never
      // hear about it).
      setAnnouncement(`Question déplacée en position ${target + 1}.`)
    } catch (err) {
      setActionError(errorMessage(err))
      setQuestions(previous)
      // The list just reverted to `previous` — keep focus with the item
      // (back at its original position) and correct the record for
      // screen-reader users, who otherwise never learn the move didn't stick.
      pendingFocus.current = { kind: 'item', id: moved.id }
      setAnnouncement(
        `Déplacement annulé, la question est revenue en position ${index + 1}.`,
      )
    }
  }

  async function addQuestion() {
    if (!currentQuizId) return
    try {
      setActionError(null)
      const created = await createQuestion(currentQuizId, defaultCreateInput('mcq'))
      const q = fromApiQuestion(created)
      primeSaved(q)
      setQuestions((prev) => [...prev, q])
      setSelectedId(q.id)
      setAnnouncement('Question ajoutée.')
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }

  async function removeQuestion(id: string) {
    if (!currentQuizId) return
    const index = questions.findIndex((q) => q.id === id)
    if (index < 0) return
    const removed = questions[index]
    try {
      setActionError(null)
      await deleteQuestion(currentQuizId, id)
    } catch (err) {
      setActionError(errorMessage(err))
      return // deletion did not happen server-side — keep it in the list
    }
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

  /** Deletion is permanent server-side (204, no soft-delete) — there is no
   * "restore" endpoint. "Annuler" re-creates the question from the content
   * it had (new id under the hood) and puts it back at its original list
   * position via `reorderQuestions`. Indistinguishable from a true undo from
   * the host's point of view. */
  async function undoDelete() {
    if (!lastDeleted || !currentQuizId) return
    const { question: q, index } = lastDeleted
    const quizId = currentQuizId
    try {
      setActionError(null)
      const created = await createQuestion(quizId, toCreateInput(q))
      const restored = fromApiQuestion(created)
      primeSaved(restored)
      pendingFocus.current = { kind: 'item', id: restored.id }
      // Computed as a plain local array, not read back out of a
      // `setQuestions` functional-updater closure — see the comment in
      // `applyTypeChangeImmediate` for why that pattern can silently send an
      // empty/stale orderedIds list.
      const next = [...questions]
      next.splice(Math.min(index, next.length), 0, restored)
      setQuestions(next)
      setSelectedId(restored.id)
      setLastDeleted(null)
      setAnnouncement('Question restaurée.')
      await reorderQuestions(
        quizId,
        next.map((x) => x.id),
      )
    } catch (err) {
      setActionError(errorMessage(err))
      // Best-effort resync so the list doesn't silently diverge from the
      // server: if `createQuestion` above succeeded but the following
      // `reorderQuestions` failed, the UI would otherwise keep showing the
      // restored question at its original position while the server
      // actually appended it at the end (creation always appends). Same
      // rationale as `applyTypeChangeImmediate`'s catch.
      loadQuestions(quizId)
    }
  }

  function selectQuiz(id: string) {
    setCurrentQuizId(id)
    localStorage.setItem(LAST_QUIZ_KEY, id)
  }

  async function handleCreateQuiz(event: FormEvent) {
    event.preventDefault()
    const trimmed = newQuizTitle.trim()
    if (trimmed.length === 0) {
      setNewQuizError('Le titre est requis.')
      newQuizTitleRef.current?.focus()
      return
    }
    setNewQuizPending(true)
    try {
      const created = await createQuiz({ title: trimmed })
      setQuizzes((prev) => [...prev, created])
      setNewQuizTitle('')
      setNewQuizError(null)
      setCreatingQuiz(false)
      selectQuiz(created.id)
      quizPickerRef.current?.focus()
    } catch (err) {
      setNewQuizError(errorMessage(err))
    } finally {
      setNewQuizPending(false)
    }
  }

  async function saveQuizField(patch: { title?: string; description?: string | null }) {
    if (!currentQuizId) return
    try {
      const updated = await updateQuiz(currentQuizId, patch)
      setQuizzes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)))
      setActionError(null)
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }

  // Title/description are saved on blur rather than per-keystroke or on a
  // fixed debounce timer: they're the two fields least likely to need
  // instant persistence (unlike question content, nothing downstream reads
  // them mid-edit), and "commit on leaving the field" is a familiar, simple
  // mental model that also naturally coalesces rapid typing into one call.
  function handleTitleBlur() {
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      setTitleError('Le titre est requis.')
      return
    }
    setTitleError(null)
    const current = quizzes.find((q) => q.id === currentQuizId)
    if (current && current.title === trimmed) return
    void saveQuizField({ title: trimmed })
  }

  function handleDescriptionBlur() {
    const current = quizzes.find((q) => q.id === currentQuizId)
    const normalized = description.trim().length > 0 ? description : null
    if (current && (current.description ?? null) === normalized) return
    void saveQuizField({ description: normalized })
  }

  /* ---------------------------------------------------------------- */
  /* Full-page states: loading / error / empty                          */
  /* ---------------------------------------------------------------- */

  if (quizzesLoading) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Chargement de vos quiz…</p>
      </main>
    )
  }

  if (quizzesError && quizzes.length === 0) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {quizzesError}
        </p>
        <Button variant="primary" type="button" onClick={loadQuizzes}>
          Réessayer
        </Button>
      </main>
    )
  }

  if (quizzes.length === 0) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <h1>Créez votre premier quiz</h1>
        <p className="ab-empty-state">Vous n'avez encore aucun quiz. Donnez-lui un titre pour commencer.</p>
        <form className="join-card" onSubmit={handleCreateQuiz} noValidate>
          {newQuizError && (
            <p className="join-error" role="alert" id="new-quiz-title-error">
              {newQuizError}
            </p>
          )}
          <div className="join-field">
            <label htmlFor="first-quiz-title">Titre du quiz</label>
            <input
              id="first-quiz-title"
              ref={newQuizTitleRef}
              type="text"
              value={newQuizTitle}
              onChange={(e) => setNewQuizTitle(e.target.value)}
              placeholder="Ex. Culture générale — spécial vendredi"
              aria-invalid={newQuizError ? true : undefined}
              aria-describedby={newQuizError ? 'new-quiz-title-error' : undefined}
            />
          </div>
          <Button variant="primary" type="submit" disabled={newQuizPending}>
            {newQuizPending ? 'Création…' : 'Créer le quiz'}
          </Button>
        </form>
      </main>
    )
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
              e.preventDefault()
              if (!canLaunch) return
              // TODO(Plan 06 Task 5): host:create {quizId} via the game
              // socket → {sessionId, pin}, then navigate to
              // /host/:sessionId. Intentionally a no-op for now — do NOT
              // fake a PIN or a session here.
            }}
          >
            Lancer la partie
          </Button>
          {launchReason && <p className="host-launch__hint">{launchReason}</p>}
        </div>
      </header>

      <main
        className="ab-shell__main"
        id="contenu-principal"
        tabIndex={-1}
        aria-hidden={pendingType ? true : undefined}
      >
        <h1 style={{ marginBottom: 'var(--space-4)' }}>Éditeur de quiz</h1>

        {actionError && (
          <p className="join-error" role="alert">
            {actionError}
          </p>
        )}

        <section className="host-field-row" aria-label="Sélection du quiz" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="host-field">
            <label htmlFor="quiz-picker">Quiz</label>
            <select
              id="quiz-picker"
              ref={quizPickerRef}
              value={currentQuizId ?? ''}
              onChange={(e) => selectQuiz(e.target.value)}
            >
              {quizzes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
          </div>
          <div className="host-field" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" type="button" onClick={() => setCreatingQuiz((v) => !v)}>
              {creatingQuiz ? 'Annuler' : 'Nouveau quiz'}
            </Button>
          </div>
        </section>

        {creatingQuiz && (
          <form className="host-meta" onSubmit={handleCreateQuiz} noValidate>
            {newQuizError && (
              <p className="join-error" role="alert" id="new-quiz-title-error">
                {newQuizError}
              </p>
            )}
            <div className="host-field">
              <label htmlFor="new-quiz-title">Titre du nouveau quiz</label>
              <input
                id="new-quiz-title"
                ref={newQuizTitleRef}
                type="text"
                value={newQuizTitle}
                onChange={(e) => setNewQuizTitle(e.target.value)}
                placeholder="Ex. Spécial géographie"
                aria-invalid={newQuizError ? true : undefined}
                aria-describedby={newQuizError ? 'new-quiz-title-error' : undefined}
              />
            </div>
            <div className="host-actions">
              <Button variant="primary" type="submit" disabled={newQuizPending}>
                {newQuizPending ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </form>
        )}

        <div className="host-meta">
          <div className="host-field">
            <label htmlFor="quiz-title">Titre du quiz</label>
            <input
              id="quiz-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Ex. Culture générale — spécial vendredi"
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? 'quiz-title-error' : undefined}
            />
            {titleError && (
              <p className="host-inline-error" id="quiz-title-error">
                {titleError}
              </p>
            )}
          </div>
          <div className="host-field">
            <label htmlFor="quiz-description">Description</label>
            <textarea
              id="quiz-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
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

        {questionsLoading ? (
          <p role="status">Chargement des questions…</p>
        ) : questionsError && questions.length === 0 ? (
          <div className="ab-empty-state">
            <p role="alert">{questionsError}</p>
            <Button variant="primary" type="button" onClick={() => currentQuizId && loadQuestions(currentQuizId)}>
              Réessayer
            </Button>
          </div>
        ) : (
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
                            onClick={() => void move(index, -1)}
                            disabled={index === 0}
                            aria-label={`Monter la question ${index + 1}`}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="host-list__reorder-btn"
                            onClick={() => void move(index, 1)}
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
                <Button variant="ghost" type="button" onClick={() => void addQuestion()} ref={addRef}>
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
                        value={selected.timeLimit}
                        onChange={(e) => updateSelected({ timeLimit: Number(e.target.value) })}
                        aria-invalid={fErrors['q-duration'] ? true : undefined}
                        aria-describedby={fErrors['q-duration'] ? 'q-duration-error' : undefined}
                      />
                      {fErrors['q-duration'] && (
                        <p className="host-inline-error" id="q-duration-error">
                          {fErrors['q-duration']}
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
                          aria-invalid={fErrors['q-slider-step'] ? true : undefined}
                          aria-describedby={fErrors['q-slider-step'] ? 'q-slider-step-error' : undefined}
                        />
                        {fErrors['q-slider-step'] && (
                          <p className="host-inline-error" id="q-slider-step-error">
                            {fErrors['q-slider-step']}
                          </p>
                        )}
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
                    <Button variant="danger" type="button" onClick={() => void removeQuestion(selected.id)}>
                      Supprimer la question
                    </Button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
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
              durée) est conservé.
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
