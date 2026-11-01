import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { signOut, useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { useLaunchGame } from '../realtime/useLaunchGame'
import {
  archiveQuiz,
  createQuestion,
  deleteQuestion,
  getQuiz,
  listQuestions,
  reorderQuestions,
  restoreQuiz,
  updateQuestion,
  updateQuiz,
  type ContentSource,
  type CreateQuestionInput,
  type Question as ApiQuestion,
  type QuestionType,
  type Quiz,
  type UpdateQuestionInput,
} from '../api/quizzes'
import { ANSWER_SHAPES, type AnswerShapeKind } from '../constants'
import { AnswerShape, Button, Logo, SHAPE_NAME_FR } from '../ui'
import { AppHeader } from '../ui/AppHeader.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { SourcesPanel } from '../ui/SourceCredit.js'

/**
 * HostEditor — wired to the real quiz/question REST API (Plan 06 Task 3),
 * now addressing a SPECIFIC quiz via the route (Plan 07 Task 4:
 * `/quizzes/:quizId`, read with `useParams`) instead of an internal
 * quiz-picker/selection state — picking and creating a quiz now happens on
 * `Home` (`screens/Home.tsx`), which navigates here once one is chosen.
 * Persists every edit through `src/api/quizzes.ts`. See the module comments
 * below for the three deliberate adaptations forced by the real API's shape
 * (no `points` field, immutable question `type`, permanent deletion) — the
 * plan explicitly allows "adapt minimally, don't redesign" for exactly this
 * situation.
 */

const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'QCM',
  truefalse: 'Vrai / Faux',
  text: 'Réponse libre',
  slider: 'Curseur',
  wordcloud: 'Nuage de mots',
  poll: 'Sondage',
}

/** Decorative only (color + glyph reinforcing the shape cue on mcq tiles) —
 * never persisted. Shared with `ui.tsx` via `src/constants.ts`. */
const MCQ_SHAPES = ANSWER_SHAPES

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
  readingTime: number
  /** Attribution héritée de la bibliothèque (absente pour une question créée ici). */
  source?: ContentSource | null
}
interface McqOption {
  id: string
  shape: AnswerShapeKind
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
export interface WordcloudQuestion extends QuestionBase {
  type: 'wordcloud'
}
export interface PollQuestion extends QuestionBase {
  type: 'poll'
  options: { id: string; label: string }[]
  multiple: boolean
}
export type Question =
  | McqQuestion
  | TrueFalseQuestion
  | TextQuestion
  | SliderQuestion
  | WordcloudQuestion
  | PollQuestion

const POLL_MIN_OPTIONS = 2
const POLL_MAX_OPTIONS = 6

function fromApiQuestion(row: ApiQuestion): Question {
  const base = { id: row.id, prompt: row.prompt, timeLimit: row.timeLimit, readingTime: row.readingTime, source: row.source }
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
    case 'wordcloud':
      return { ...base, type: 'wordcloud' }
    case 'poll': {
      const payload = row.payload as { options: { label: string }[]; multiple?: boolean }
      return {
        ...base,
        type: 'poll',
        options: payload.options.map((o, i) => ({ id: `opt-${i}`, label: o.label })),
        multiple: payload.multiple ?? false,
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
        readingTime: q.readingTime,
        payload: { options: q.options.map((o) => ({ label: o.label, correct: o.correct })) },
      }
    case 'truefalse':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        readingTime: q.readingTime,
        payload: { correct: q.correctAnswer },
      }
    case 'text':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        readingTime: q.readingTime,
        payload: {
          answers: q.acceptedAnswers.map((a) => a.trim()).filter((a) => a.length > 0),
          caseSensitive: false,
        },
      }
    case 'slider':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        readingTime: q.readingTime,
        payload: { min: q.min, max: q.max, correct: q.correctValue, step: q.step > 0 ? q.step : undefined },
      }
    case 'wordcloud':
      return { prompt: q.prompt, timeLimit: q.timeLimit, readingTime: q.readingTime, payload: {} }
    case 'poll':
      return {
        prompt: q.prompt,
        timeLimit: q.timeLimit,
        readingTime: q.readingTime,
        payload: { options: q.options.map((o) => ({ label: o.label })), multiple: q.multiple },
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
  const readingTime = 6
  switch (type) {
    case 'mcq':
      return {
        type,
        prompt,
        timeLimit,
        readingTime,
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
      return { type, prompt, timeLimit, readingTime, payload: { correct: true } }
    case 'text':
      return { type, prompt, timeLimit, readingTime, payload: { answers: ['Réponse'], caseSensitive: false } }
    case 'slider':
      return { type, prompt, timeLimit, readingTime, payload: { min: 0, max: 100, correct: 50, step: 1 } }
    case 'wordcloud':
      return { type, prompt, timeLimit, readingTime, payload: {} }
    case 'poll':
      return {
        type,
        prompt,
        timeLimit,
        readingTime,
        payload: {
          options: [{ label: 'Choix 1' }, { label: 'Choix 2' }, { label: 'Choix 3' }, { label: 'Choix 4' }],
          multiple: false,
        },
      }
  }
}

/** True when a question carries type-specific data that changing type would wipe. */
function hasTypeSpecificData(q: Question): boolean {
  switch (q.type) {
    case 'mcq':
    case 'poll':
      return q.options.some((o) => o.label.trim().length > 0)
    case 'text':
      return q.acceptedAnswers.some((a) => a.trim().length > 0)
    case 'truefalse':
    case 'slider':
    case 'wordcloud':
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
  // 0 = pas de temps de lecture (valeur légitime), donc seul le signe/l'intégrité est vérifié —
  // pas de borne haute produit comme pour `timeLimit`.
  if (!Number.isInteger(q.readingTime) || q.readingTime < 0)
    return 'Le temps de lecture doit être un entier ≥ 0.'
  switch (q.type) {
    case 'mcq': {
      if (q.options.some((o) => o.label.trim().length === 0))
        return 'Chaque réponse doit avoir un libellé.'
      if (!q.options.some((o) => o.correct)) return 'Choisissez la bonne réponse.'
      return null
    }
    case 'poll':
      return q.options.some((o) => o.label.trim().length === 0)
        ? 'Chaque choix doit avoir un libellé.'
        : null
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
    case 'wordcloud':
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
  if (!Number.isInteger(q.readingTime) || q.readingTime < 0)
    errs['q-reading-time'] = 'Le temps de lecture doit être un entier ≥ 0.'
  switch (q.type) {
    case 'mcq':
      q.options.forEach((o, i) => {
        if (o.label.trim().length === 0)
          errs[`mcq-label-${o.id}`] = `Réponse ${i + 1} : libellé manquant.`
      })
      if (!q.options.some((o) => o.correct)) errs['mcq-correct'] = 'Choisissez la bonne réponse.'
      break
    case 'poll':
      q.options.forEach((o) => {
        if (o.label.trim().length === 0) errs[`poll-label-${o.id}`] = 'Chaque choix doit avoir un libellé.'
      })
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
    case 'wordcloud':
      break
  }
  return errs
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur réseau est survenue. Réessayez.'
}

/** A debounced-but-not-yet-sent question edit, tracked in `pendingSaveRef` so it can be flushed on
 * demand (switching to another question, launching the game) instead of only ever firing from
 * `saveTimerRef`'s 600ms timeout — see the Plan 06 review's critical finding #1. */
interface PendingSave {
  quizId: string
  id: string
  patch: UpdateQuestionInput
  key: string
}

export function HostEditor() {
  const navigate = useNavigate()
  // Guaranteed present by the matching route (`/quizzes/:quizId`) — `useParams`
  // types it optional only because react-router can't know that statically.
  const { quizId } = useParams<{ quizId: string }>()
  const { launch } = useLaunchGame()
  const { refresh: refreshSession } = useSession()
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  /** There was previously NO sign-out affordance anywhere in the app (Plan 06 review finding #8) —
   * `signOut()` was exported from `api/auth.tsx` but called from zero call sites. Best-effort: even
   * if the server call fails (network blip), clear the client's session state and navigate to
   * `/login` regardless — staying "logged in" on a screen the host just asked to leave would be
   * worse than a redundant sign-in prompt. */
  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      // Ignored deliberately — see comment above.
    } finally {
      await refreshSession()
      navigate('/login')
    }
  }

  /** "← Retour à l'accueil" (Task 4 review, carried-over fix): a plain `<Link
   * to="/">` here would navigate away WITHOUT flushing whatever question edit
   * is still only debounced (`pendingSaveRef`) — the host could silently lose
   * a pending edit. Flush first (fire-and-forget, same as the removed
   * `selectQuiz`'s old navigation used to do — `launchGame` is the only
   * caller that AWAITS a flush, since a failed launch must be visible;
   * leaving the editor is lower-stakes and shouldn't block on the network),
   * then navigate regardless of whether the flush actually lands. */
  function handleBackToHome() {
    void flushPendingSave()
    navigate('/')
  }

  // --- The quiz addressed by the route ------------------------------------
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [quizLoading, setQuizLoading] = useState(true)
  // 404 (quiz gone/not this tenant's) gets its own flag: it's not a transient
  // failure a "Réessayer" button can fix, and the message/affordance differ
  // (see the full-page states below).
  const [quizNotFound, setQuizNotFound] = useState(false)
  const [quizError, setQuizError] = useState<string | null>(null)

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
  // Archivage (suppression douce) : confirmation modale, puis retour à l'accueil. Un quiz archivé
  // reste modifiable ici mais n'est plus lançable tant qu'il n'est pas restauré.
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [archivePending, setArchivePending] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [restorePending, setRestorePending] = useState(false)

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
  // The one debounced-but-not-yet-sent edit, if any — see `flushPendingSave` below for why this
  // needs to be flushable on demand rather than only ever fired by `saveTimerRef`'s timeout.
  const pendingSaveRef = useRef<PendingSave | null>(null)

  function primeSaved(q: Question) {
    lastSavedRef.current.set(q.id, JSON.stringify(toQuestionPatch(q)))
  }

  /* ---------------------------------------------------------------- */
  /* Load the quiz addressed by the route                                */
  /* ---------------------------------------------------------------- */
  function loadQuiz(id: string) {
    setQuizLoading(true)
    setQuizNotFound(false)
    setQuizError(null)
    getQuiz(id)
      .then((row) => {
        setQuiz(row)
        setTitle(row.title)
        setDescription(row.description ?? '')
        setTitleError(null)
        setQuizLoading(false)
      })
      .catch((err) => {
        setQuizLoading(false)
        if (err instanceof ApiError && err.status === 404) {
          setQuizNotFound(true)
        } else {
          setQuizError(errorMessage(err))
        }
      })
  }

  useEffect(() => {
    if (!quizId) return
    loadQuiz(quizId)
    // Re-runs if the route param itself changes (navigating between two
    // quizzes' editors without an intervening full reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId])

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
    if (!quizId) {
      setQuestions([])
      setSelectedId(null)
      return
    }
    loadQuestions(quizId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId])

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
  const isArchived = quiz?.archivedAt != null
  const launchReason = isArchived
    ? 'Ce quiz est archivé : restaurez-le pour lancer une partie.'
    : questions.length === 0
      ? 'Ajoutez au moins une question pour lancer la partie.'
      : invalidCount > 0
        ? `${invalidCount} question${invalidCount > 1 ? 's' : ''} à compléter avant de lancer la partie.`
        : null
  const canLaunch = launchReason === null

  /** Actually PATCHes one pending question edit and records it as saved. Shared by the debounce
   * timer and by `flushPendingSave` below, so both paths update `lastSavedRef`/`actionError`
   * identically. Throws on failure (after surfacing the message in `actionError`) so a caller that
   * needs to know the flush failed — `launchGame` — can react instead of silently proceeding. */
  async function persistQuestionPatch(entry: PendingSave): Promise<void> {
    try {
      await updateQuestion(entry.quizId, entry.id, entry.patch)
      lastSavedRef.current.set(entry.id, entry.key)
      setActionError(null)
    } catch (err) {
      setActionError(errorMessage(err))
      throw err
    }
  }

  /**
   * Flushes whatever question edit is currently debounced, bypassing the 600ms delay, and returns
   * once it's actually persisted (or immediately if nothing is pending). Two call sites:
   *  - the debounce effect below, right before it moves its single timer/pending-slot to a
   *    DIFFERENT question — so switching away from an edited question no longer silently drops
   *    it (Plan 06 review, critical finding #1, first loss path).
   *  - `launchGame`, awaited before `host:create` — which reads the questions straight from the
   *    database — so a launch can never run against content the editor still shows as unsaved
   *    (same finding, second — worse — loss path: launching on stale content).
   */
  async function flushPendingSave(): Promise<void> {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const entry = pendingSaveRef.current
    if (!entry) return
    pendingSaveRef.current = null
    await persistQuestionPatch(entry)
  }

  /** « Lancer la partie » : délègue le `host:create {quizId}` + la navigation vers
   * `/host/:sessionId` au hook partagé `useLaunchGame` (voir sa doc — même socket que `HostLive`
   * réutilisera, même contrat succès/échec). Ce qui reste ICI, spécifique à l'éditeur : le garde
   * `canLaunch`/`launching`, et le flush de l'édition en attente AVANT d'appeler `launch` — le
   * point du Plan 06 review finding #1 est que `host:create` lit les questions directement en
   * base, donc lancer pendant qu'une édition n'est encore que debounced côté client (ou pire,
   * n'a pas pu être flushée) ferait tourner la partie sur un contenu périmé.
   *
   * `flushPendingSave()` est awaited EN PREMIER, et son échec court-circuite le lancement
   * entièrement (message dédié, distinct de celui d'un échec de `launch`). */
  async function launchGame() {
    if (!canLaunch || launching || !quizId) return
    setLaunching(true)
    setLaunchError(null)
    try {
      await flushPendingSave()
    } catch (err) {
      setLaunching(false)
      setLaunchError(
        `Vos dernières modifications n'ont pas pu être enregistrées, la partie n'a pas été lancée. ${errorMessage(err)}`,
      )
      return
    }
    try {
      await launch(quizId, title)
    } catch (err) {
      setLaunching(false)
      setLaunchError(err instanceof Error ? err.message : 'Impossible de lancer la partie.')
    }
  }

  // Debounced autosave for the currently selected question: fires 600ms
  // after the last edit, only when the draft passes client-side validation
  // (an invalid draft is never sent — the "Incomplete" state stays local
  // until fixed) and only when it actually differs from what was last
  // persisted (see lastSavedRef above).
  useEffect(() => {
    if (!selected || !quizId) return
    if (validationError(selected)) return
    const patch = toQuestionPatch(selected)
    const key = JSON.stringify(patch)
    if (lastSavedRef.current.get(selected.id) === key) return
    const id = selected.id

    // Switching away from a DIFFERENT question that still has an unsent debounced edit: flush it
    // immediately instead of just clearing its timer below (which used to drop it — see
    // `flushPendingSave`'s doc comment). Fire-and-forget here (best-effort, mirrors the original
    // timer's fire-and-forget save) — `launchGame` is what actually AWAITS a flush.
    if (pendingSaveRef.current && pendingSaveRef.current.id !== id) {
      const outgoing = pendingSaveRef.current
      pendingSaveRef.current = null
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      void persistQuestionPatch(outgoing).catch(() => {
        // Already surfaced via actionError inside persistQuestionPatch; nothing further to do
        // here (there is no more specific UI target once we've navigated away from this question).
      })
    }

    pendingSaveRef.current = { quizId, id, patch, key }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const toSave = pendingSaveRef.current
      if (!toSave || toSave.id !== id) return
      pendingSaveRef.current = null
      void persistQuestionPatch(toSave).catch(() => {})
    }, 600)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, quizId])

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
    input.readingTime = keep.readingTime
    return fromApiQuestion({
      id: keep.id,
      quizId: '',
      type,
      prompt: input.prompt,
      media: null,
      timeLimit: input.timeLimit,
      readingTime: input.readingTime ?? 0,
      orderIndex: 0,
      payload: input.payload,
      source: null,
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
   * possible; here it's simulated by creating a new row of the new type and
   * only THEN deleting the old one (fixed up with an explicit
   * `reorderQuestions` call, since creation always appends at the end). The
   * new row necessarily gets a NEW id — invisible to the host, but worth
   * knowing if you're reading network logs.
   *
   * CREATE-then-delete, not delete-then-create (Plan 06 review, critical
   * finding #6): with delete first, a `createQuestion` failure (network blip,
   * validation) left the original question already gone with nothing to
   * restore — a type change could permanently destroy a question. Creating
   * first means a failed create leaves the original completely untouched; the
   * only remaining failure mode is the delete itself failing AFTER the create
   * succeeded, which leaves both rows momentarily present server-side rather
   * than destroying anything — handled below by resyncing from the server so
   * the host can see and manually clear the leftover duplicate. */
  async function applyTypeChangeImmediate(type: QuestionType) {
    if (!selected || !quizId) return
    const originalId = selected.id
    const index = questions.findIndex((q) => q.id === originalId)
    const draft = draftForType(type, selected)
    let created: ApiQuestion
    try {
      setActionError(null)
      created = await createQuestion(quizId, toCreateInput(draft))
    } catch (err) {
      // Create itself failed: nothing changed server-side, the original question is intact and
      // still selected — no resync needed, just surface the message.
      setActionError(errorMessage(err))
      return
    }
    const next = fromApiQuestion(created)
    primeSaved(next)
    try {
      await deleteQuestion(quizId, originalId)
    } catch (err) {
      // The new row now exists ALONGSIDE the old one server-side — never silently drop either;
      // resync from the server so the host sees the duplicate for what it is (and can delete the
      // leftover original manually) instead of the local list quietly diverging from reality.
      setActionError(
        `La nouvelle question a été créée, mais l'ancienne n'a pas pu être supprimée : ${errorMessage(err)}. Liste resynchronisée, vous pouvez supprimer le doublon manuellement.`,
      )
      loadQuestions(quizId)
      return
    }
    // Computed as a plain local array (like `move()`), NOT captured from
    // inside a `setQuestions` functional-updater callback: React doesn't
    // guarantee that updater runs synchronously before the next line, so
    // reading a closure variable it assigns can still see it unset — which
    // previously sent `reorderQuestions` an EMPTY orderedIds list (still
    // "succeeds" server-side, vacuously, silently leaving the real order
    // wrong). `questions` here is the current render's list, safe to read
    // synchronously since nothing else mutates it between this render and
    // this call.
    const spliced = questions.filter((q) => q.id !== originalId)
    spliced.splice(Math.min(index, spliced.length), 0, next)
    setQuestions(spliced)
    setSelectedId(next.id)
    try {
      await reorderQuestions(
        quizId,
        spliced.map((q) => q.id),
      )
    } catch (err) {
      setActionError(errorMessage(err))
      // Best-effort resync so the list doesn't silently diverge from the server if the reorder
      // didn't stick (create + delete already succeeded at this point).
      loadQuestions(quizId)
    }
  }

  async function confirmArchive() {
    if (!quizId) return
    setArchivePending(true)
    setArchiveError(null)
    try {
      // Même logique que « Retour à l'accueil » : on n'abandonne pas une édition en attente.
      await flushPendingSave().catch(() => {})
      await archiveQuiz(quizId)
      navigate('/')
    } catch (err) {
      setArchivePending(false)
      setArchiveError(errorMessage(err))
    }
  }

  async function handleRestore() {
    if (!quizId) return
    setRestorePending(true)
    setActionError(null)
    try {
      const row = await restoreQuiz(quizId)
      setQuiz(row)
      setAnnouncement('Quiz restauré, il peut de nouveau être lancé.')
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setRestorePending(false)
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
    if (!quizId) return
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
        quizId,
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
    if (!quizId) return
    try {
      setActionError(null)
      const created = await createQuestion(quizId, defaultCreateInput('mcq'))
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
    if (!quizId) return
    const index = questions.findIndex((q) => q.id === id)
    if (index < 0) return
    const removed = questions[index]
    try {
      setActionError(null)
      await deleteQuestion(quizId, id)
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
    if (!lastDeleted || !quizId) return
    const { question: q, index } = lastDeleted
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

  async function saveQuizField(patch: { title?: string; description?: string | null }) {
    if (!quizId) return
    try {
      const updated = await updateQuiz(quizId, patch)
      setQuiz(updated)
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
    if (quiz && quiz.title === trimmed) return
    void saveQuizField({ title: trimmed })
  }

  function handleDescriptionBlur() {
    const normalized = description.trim().length > 0 ? description : null
    if (quiz && (quiz.description ?? null) === normalized) return
    void saveQuizField({ description: normalized })
  }

  /* ---------------------------------------------------------------- */
  /* Full-page states: loading / not found / error                      */
  /* ---------------------------------------------------------------- */

  if (quizLoading) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p role="status">Chargement du quiz…</p>
      </main>
    )
  }

  // Not the same as `quizError` below: a 404 (deleted quiz, another
  // tenant's, stale/bookmarked link, typo'd URL) isn't a transient failure a
  // "Réessayer" button can fix by retrying the same request — the only way
  // forward is back to the quiz list.
  if (quizNotFound) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          Quiz introuvable.
        </p>
        <Link className="ab-button ab-button--primary" to="/">
          ← Retour à l'accueil
        </Link>
      </main>
    )
  }

  if (quizError || !quiz) {
    return (
      <main className="join-screen" id="contenu-principal" tabIndex={-1}>
        <Logo />
        <p className="join-error" role="alert">
          {quizError ?? 'Une erreur inattendue est survenue.'}
        </p>
        <Button variant="primary" type="button" onClick={() => quizId && loadQuiz(quizId)}>
          Réessayer
        </Button>
      </main>
    )
  }

  const modalOpen = pendingType !== null || archiveDialogOpen

  return (
    <div className="ab-shell">
      <div aria-hidden={modalOpen ? true : undefined}>
        <AppHeader
          brandline={
            <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-small)' }}>
              <button type="button" className="host-link-button" onClick={handleBackToHome}>
                ← Retour à l'accueil
              </button>{' '}
              ({title})
            </span>
          }
          actions={
            <>
              <Button variant="ghost" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
                {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
              </Button>
              {/* La raison du blocage n'est affichée qu'une fois, dans le
                  bandeau #host-launch-reason sous le titre : la répéter ici
                  faisait changer la hauteur de l'en-tête et désalignait
                  « Se déconnecter ». */}
              <Button
                variant="primary"
                type="button"
                aria-disabled={!canLaunch || launching}
                aria-describedby={!canLaunch ? 'host-launch-reason' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  if (!canLaunch || launching) return
                  void launchGame()
                }}
              >
                {launching ? 'Lancement…' : 'Lancer la partie'}
              </Button>
            </>
          }
        />
      </div>

      <main
        className="ab-shell__main"
        id="contenu-principal"
        tabIndex={-1}
        aria-hidden={modalOpen ? true : undefined}
      >
        <h1 style={{ marginBottom: 'var(--space-4)' }}>Éditeur de quiz</h1>

        {/* Quiz archivé : l'id `host-launch-reason` porte ici la raison du blocage du lancement
            (référencée par l'`aria-describedby` du bouton « Lancer la partie »). */}
        {isArchived && (
          <div className="host-archived">
            <p id="host-launch-reason">
              Ce quiz est archivé. Restaurez-le pour pouvoir lancer une partie.
            </p>
            <Button variant="primary" type="button" disabled={restorePending} onClick={() => void handleRestore()}>
              {restorePending ? 'Restauration…' : 'Restaurer'}
            </Button>
          </div>
        )}

        {launchError && (
          <p className="join-error" role="alert">
            {launchError}
          </p>
        )}

        {actionError && (
          <p className="join-error" role="alert">
            {actionError}
          </p>
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
              placeholder="Ex. Culture générale, spécial vendredi"
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

        {launchReason && !isArchived && (
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
            <Button variant="primary" type="button" onClick={() => quizId && loadQuestions(quizId)}>
              Réessayer
            </Button>
          </div>
        ) : (
          <div className="host-layout">
            <section aria-label="Liste des questions">
              <h2 style={{ marginBottom: 'var(--space-3)' }}>Questions</h2>
              {questions.length === 0 ? (
                <p className="ab-empty-state">Aucune question pour l'instant, ajoutez-en une pour commencer.</p>
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
              <SourcesPanel quizSource={quiz?.source ?? null} questionSources={questions.map((q) => q.source ?? null)} />
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
                        <option value="wordcloud">Nuage de mots</option>
                        <option value="poll">Sondage</option>
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
                    <div className="host-field">
                      <label htmlFor="q-reading-time">Temps de lecture (s)</label>
                      <input
                        id="q-reading-time"
                        type="number"
                        min={0}
                        value={selected.readingTime}
                        onChange={(e) => updateSelected({ readingTime: Number(e.target.value) })}
                        aria-invalid={fErrors['q-reading-time'] ? true : undefined}
                        aria-describedby={
                          fErrors['q-reading-time'] ? 'q-reading-time-error q-reading-time-help' : 'q-reading-time-help'
                        }
                      />
                      <p className="host-field__help" id="q-reading-time-help">
                        0 = pas de temps de lecture
                      </p>
                      {fErrors['q-reading-time'] && (
                        <p className="host-inline-error" id="q-reading-time-error">
                          {fErrors['q-reading-time']}
                        </p>
                      )}
                    </div>
                  </div>

                  {(selected.type === 'mcq' || selected.type === 'poll') && (
                    <fieldset className="host-field">
                      <legend>
                        {selected.type === 'poll' ? 'Choix' : 'Réponses (cochez la bonne réponse)'}
                      </legend>
                      {selected.type === 'mcq' && fErrors['mcq-correct'] && (
                        <p className="host-inline-error" id="mcq-correct-error">
                          {fErrors['mcq-correct']}
                        </p>
                      )}
                      <div className="host-options-grid">
                        {selected.options.map((opt, index) => (
                          <div className="host-option-row" key={opt.id}>
                            {selected.type === 'mcq' && 'correct' in opt && (
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
                            )}
                            <span className="host-option-row__shape">
                              <AnswerShape shape={MCQ_SHAPES[index % MCQ_SHAPES.length]} size={20} />
                            </span>
                            <label htmlFor={`${selected.type}-label-${opt.id}`} className="visually-hidden">
                              {selected.type === 'poll' ? 'Libellé choix' : 'Libellé réponse'} {index + 1},{' '}
                              {SHAPE_NAME_FR[MCQ_SHAPES[index % MCQ_SHAPES.length]]}
                            </label>
                            <input
                              id={`${selected.type}-label-${opt.id}`}
                              type="text"
                              value={opt.label}
                              placeholder={`${selected.type === 'poll' ? 'Choix' : 'Réponse'} ${index + 1}`}
                              onChange={(e) => {
                                const options = selected.options.map((o, i) =>
                                  i === index ? { ...o, label: e.target.value } : o,
                                )
                                updateSelected({ options } as Partial<McqQuestion | PollQuestion>)
                              }}
                              aria-invalid={fErrors[`${selected.type}-label-${opt.id}`] ? true : undefined}
                              aria-describedby={
                                fErrors[`${selected.type}-label-${opt.id}`]
                                  ? `${selected.type}-label-${opt.id}-error`
                                  : undefined
                              }
                            />
                            {selected.type === 'poll' && (
                              <button
                                type="button"
                                className="host-variant-remove"
                                aria-label={`Retirer le choix ${index + 1}`}
                                disabled={selected.options.length <= POLL_MIN_OPTIONS}
                                onClick={() => {
                                  const options = selected.options.filter((_, i) => i !== index)
                                  updateSelected({ options } as Partial<PollQuestion>)
                                }}
                              >
                                ✕
                              </button>
                            )}
                            {fErrors[`${selected.type}-label-${opt.id}`] && (
                              <p
                                className="host-inline-error"
                                id={`${selected.type}-label-${opt.id}-error`}
                              >
                                {fErrors[`${selected.type}-label-${opt.id}`]}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      {selected.type === 'poll' && (
                        <div style={{ marginTop: 'var(--space-2)' }}>
                          <Button
                            variant="ghost"
                            type="button"
                            disabled={selected.options.length >= POLL_MAX_OPTIONS}
                            onClick={() => {
                              const nextId = selected.options.reduce(
                                (max, o) => Math.max(max, Number(o.id.replace('opt-', '')) + 1),
                                selected.options.length,
                              )
                              updateSelected({
                                options: [...selected.options, { id: `opt-${nextId}`, label: '' }],
                              } as Partial<PollQuestion>)
                            }}
                          >
                            Ajouter un choix
                          </Button>
                        </div>
                      )}
                    </fieldset>
                  )}

                  {selected.type === 'poll' && (
                    <div className="host-field">
                      <label className="host-option-row__correct-label">
                        <input
                          type="checkbox"
                          checked={selected.multiple}
                          onChange={(e) =>
                            updateSelected({ multiple: e.target.checked } as Partial<PollQuestion>)
                          }
                        />
                        Plusieurs réponses possibles
                      </label>
                      <p className="host-field__help">
                        Les participants votent en direct. Pas de bonne réponse ni de points.
                      </p>
                    </div>
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

                  {selected.type === 'wordcloud' && (
                    <p className="host-field__help">
                      Les participants proposent leurs idées en direct. Pas de bonne réponse ni de points.
                    </p>
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

        {!isArchived && (
          <div className="host-archive-zone">
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setArchiveError(null)
                setArchiveDialogOpen(true)
              }}
            >
              Archiver ce quiz
            </Button>
          </div>
        )}
      </main>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {archiveDialogOpen && (
        <ConfirmDialog
          id="host-archive-dialog"
          title="Archiver ce quiz ?"
          description="Il quittera « Mes quiz » et ne pourra plus être lancé. Ses parties passées et leurs rapports restent consultables, et vous pourrez le restaurer depuis la section « Archivés » de l'accueil."
          confirmLabel="Archiver"
          pendingLabel="Archivage…"
          pending={archivePending}
          error={archiveError}
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiveDialogOpen(false)}
        />
      )}

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
