import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  composeQuiz,
  drawLibraryQuestions,
  duplicateLibraryQuiz,
  getLibraryMeta,
  listLibraryQuestions,
  listLibraryQuizzes,
  type Audience,
  type Difficulty,
  type LibraryFilters,
  type LibraryMeta,
  type LibraryQuestion,
  type LibraryQuizSummary,
} from '../api/library'
import { AppHeader } from '../ui/AppHeader'
import { Button } from '../ui'
import { SourceShort, SourcesNote } from '../ui/SourceCredit'
import { WorkspaceSwitcher } from '../ui/WorkspaceSwitcher'
import { useLaunchGame } from '../realtime/useLaunchGame'
import { LibraryPreview } from './LibraryPreview'

/**
 * Bibliothèque de questions : deux onglets (quiz tout prêts à prévisualiser, personnaliser ou
 * jouer tout de suite ; questions à cocher ou tirer au hasard pour composer un quiz), filtres
 * communs alimentés par `getLibraryMeta`.
 * Tout ce qui sort d'ici est une COPIE dans l'espace de l'utilisateur (le serveur s'en charge).
 */

const PAGE_SIZE = 20
const DRAW_MAX = 50
// Bornes de l'API : composition de 100 questions au plus, tirage avec 200 exclusions au plus.
const SELECTION_MAX = 100
const TITLE_MAX = 200

const DIFFICULTY_LABEL: Record<Difficulty, string> = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' }
const AUDIENCE_LABEL: Record<Audience, string> = { enfants: 'Enfants', adultes: 'Adultes', tous: 'Tous publics' }
const TYPE_LABEL: Record<string, string> = {
  mcq: 'Choix multiple',
  truefalse: 'Vrai ou faux',
  text: 'Réponse libre',
  slider: 'Curseur',
  wordcloud: 'Nuage de mots',
}

// Noms de langue en français (« fr » devient « français »), le code ISO en repli.
const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'language' })
  } catch {
    return null
  }
})()

function languageLabel(code: string): string {
  try {
    return languageNames?.of(code) ?? code
  } catch {
    return code
  }
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur réseau est survenue. Réessayez.'
}

function formatQuestionCount(count: number): string {
  return `${count} question${count > 1 ? 's' : ''}`
}

function drawMessage(found: number): string {
  if (found === 0) return 'Aucune question disponible avec ces filtres.'
  if (found === 1) return 'Seulement 1 question disponible avec ces filtres.'
  return `Seulement ${found} questions disponibles avec ces filtres.`
}

type Tab = 'quizzes' | 'questions'

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="host-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="ab-workspace-switcher__select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Tous</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Library() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('quizzes')
  const [meta, setMeta] = useState<LibraryMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [theme, setTheme] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [language, setLanguage] = useState('')
  const [audience, setAudience] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    getLibraryMeta()
      .then(setMeta)
      .catch((err) => setMetaError(errorMessage(err)))
  }, [])

  const filters: LibraryFilters = {}
  if (theme) filters.theme = theme
  if (difficulty) filters.difficulty = difficulty as Difficulty
  if (language) filters.language = language
  if (audience) filters.audience = audience as Audience
  const filterKey = JSON.stringify(filters)

  // --- Quiz tout prêts ------------------------------------------------------
  const [quizzes, setQuizzes] = useState<LibraryQuizSummary[]>([])
  const [quizzesLoading, setQuizzesLoading] = useState(true)
  const [quizzesError, setQuizzesError] = useState<string | null>(null)
  // Une seule action à la fois sur les quiz tout prêts (copie, ou copie puis lancement).
  const [pending, setPending] = useState<{ id: string; action: 'customize' | 'play' } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const { launch } = useLaunchGame()

  useEffect(() => {
    if (tab !== 'quizzes') return
    let stale = false
    setQuizzesLoading(true)
    setQuizzesError(null)
    listLibraryQuizzes(JSON.parse(filterKey) as LibraryFilters)
      .then((rows) => {
        if (stale) return
        setQuizzes(rows)
        setQuizzesLoading(false)
      })
      .catch((err) => {
        if (stale) return
        setQuizzesError(errorMessage(err))
        setQuizzesLoading(false)
      })
    return () => {
      stale = true
    }
  }, [tab, filterKey])

  /** « Personnaliser » : copie dans l'espace de l'utilisateur, puis ouverture dans l'éditeur. */
  async function handleCustomize(id: string) {
    setPending({ id, action: 'customize' })
    setActionError(null)
    try {
      const copy = await duplicateLibraryQuiz(id)
      navigate(`/quizzes/${copy.id}`)
    } catch (err) {
      setActionError(errorMessage(err))
      setPending(null)
    }
  }

  /** « Jouer maintenant » : même copie, puis lancement direct de la partie. */
  async function handlePlay(id: string) {
    setPending({ id, action: 'play' })
    setActionError(null)
    let copy: { id: string; title: string }
    try {
      copy = await duplicateLibraryQuiz(id)
    } catch (err) {
      setActionError(errorMessage(err))
      setPending(null)
      return
    }
    try {
      await launch(copy.id, copy.title)
    } catch (err) {
      // La copie existe déjà : on le dit, pour qu'un nouvel essai ne crée pas un doublon à l'aveugle.
      const reason = err instanceof Error ? err.message : 'Impossible de lancer la partie.'
      setActionError(`Le quiz a été ajouté à vos quiz, mais la partie n'a pas pu démarrer. ${reason}`)
      setPending(null)
    }
  }

  function closePreview() {
    const id = previewId
    setPreviewId(null)
    if (id) document.getElementById(`library-preview-${id}`)?.focus()
  }

  // --- Questions -------------------------------------------------------------
  const [questions, setQuestions] = useState<LibraryQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const searchTerm = search.trim()
  const requestRef = useRef(0)

  useEffect(() => {
    if (tab !== 'questions') return
    const request = ++requestRef.current
    setQuestionsLoading(true)
    setQuestionsError(null)
    const f: LibraryFilters = { ...(JSON.parse(filterKey) as LibraryFilters) }
    if (searchTerm) f.search = searchTerm
    listLibraryQuestions(f, { offset: 0, limit: PAGE_SIZE })
      .then((res) => {
        if (request !== requestRef.current) return
        setQuestions(res.items)
        setTotal(res.total)
        setQuestionsLoading(false)
      })
      .catch((err) => {
        if (request !== requestRef.current) return
        setQuestionsError(errorMessage(err))
        setQuestionsLoading(false)
      })
  }, [tab, filterKey, searchTerm])

  const loadMore = useCallback(async () => {
    const request = requestRef.current
    setMoreLoading(true)
    setQuestionsError(null)
    const f: LibraryFilters = { ...(JSON.parse(filterKey) as LibraryFilters) }
    if (searchTerm) f.search = searchTerm
    try {
      const res = await listLibraryQuestions(f, { offset: questions.length, limit: PAGE_SIZE })
      if (request !== requestRef.current) return
      setQuestions((prev) => [...prev, ...res.items.filter((q) => !prev.some((p) => p.id === q.id))])
      setTotal(res.total)
    } catch (err) {
      if (request === requestRef.current) setQuestionsError(errorMessage(err))
    } finally {
      setMoreLoading(false)
    }
  }, [filterKey, searchTerm, questions.length])

  // --- Sélection -------------------------------------------------------------
  const [selection, setSelection] = useState<LibraryQuestion[]>([])
  const [drawCount, setDrawCount] = useState('5')
  const [drawPending, setDrawPending] = useState(false)
  const [drawNote, setDrawNote] = useState<string | null>(null)
  const [drawError, setDrawError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [composePending, setComposePending] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)

  function toggleQuestion(q: LibraryQuestion) {
    setSelection((prev) => (prev.some((p) => p.id === q.id) ? prev.filter((p) => p.id !== q.id) : [...prev, q]))
  }

  async function handleDraw() {
    const room = SELECTION_MAX - selection.length
    if (room <= 0) return
    const n = Math.min(DRAW_MAX, room, Math.max(1, Math.floor(Number(drawCount)) || 1))
    setDrawCount(String(n))
    setDrawPending(true)
    setDrawNote(null)
    setDrawError(null)
    try {
      const f: LibraryFilters = { ...(JSON.parse(filterKey) as LibraryFilters) }
      if (searchTerm) f.search = searchTerm
      const drawn = await drawLibraryQuestions(f, n, selection.map((q) => q.id))
      setSelection((prev) =>
        [...prev, ...drawn.filter((q) => !prev.some((p) => p.id === q.id))].slice(0, Math.max(prev.length, SELECTION_MAX)),
      )
      setDrawNote(drawn.length < n ? drawMessage(drawn.length) : null)
    } catch (err) {
      setDrawError(errorMessage(err))
    } finally {
      setDrawPending(false)
    }
  }

  async function handleCompose(event: FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (selection.length === 0 || selection.length > SELECTION_MAX || trimmed === '') return
    setComposePending(true)
    setComposeError(null)
    try {
      const created = await composeQuiz(trimmed, selection.map((q) => q.id))
      navigate(`/quizzes/${created.id}`)
    } catch (err) {
      setComposeError(errorMessage(err))
      setComposePending(false)
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order: Tab[] = ['quizzes', 'questions']
    const last = order.length - 1
    const index = order.indexOf(tab)
    let target: number | null = null
    if (event.key === 'ArrowRight') target = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') target = index === 0 ? last : index - 1
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = last
    if (target !== null) {
      event.preventDefault()
      const next = order[target]
      setTab(next)
      document.getElementById(`library-tab-${next}`)?.focus()
    }
  }

  const themeLabel = (id: string) => meta?.themes.find((t) => t.id === id)?.label ?? id
  const selectionFull = selection.length >= SELECTION_MAX
  const canCompose = selection.length > 0 && selection.length <= SELECTION_MAX && title.trim() !== '' && !composePending

  return (
    <div className="ab-shell">
      <AppHeader actions={<WorkspaceSwitcher />} />
      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <section className="home-hero">
          <div>
            <h1>Bibliothèque</h1>
            <p className="home-hero__sub">Des quiz et des questions prêts à utiliser, copiés dans votre espace.</p>
          </div>
          <Link className="ab-button ab-button--ghost" to="/">
            Retour à l'accueil
          </Link>
        </section>

        {metaError && (
          <p className="join-error" role="alert">
            {metaError}
          </p>
        )}

        <div className="home-inline-form library-filters" role="group" aria-label="Filtres">
          <FilterSelect
            id="library-theme"
            label="Thème"
            value={theme}
            onChange={setTheme}
            options={(meta?.themes ?? []).map((t) => ({ value: t.id, label: t.label }))}
          />
          <FilterSelect
            id="library-difficulty"
            label="Difficulté"
            value={difficulty}
            onChange={setDifficulty}
            options={(meta?.difficulties ?? []).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] ?? d }))}
          />
          <FilterSelect
            id="library-language"
            label="Langue"
            value={language}
            onChange={setLanguage}
            options={(meta?.languages ?? []).map((l) => ({ value: l, label: languageLabel(l) }))}
          />
          <FilterSelect
            id="library-audience"
            label="Public"
            value={audience}
            onChange={setAudience}
            options={(meta?.audiences ?? []).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] ?? a }))}
          />
        </div>

        <div role="tablist" aria-label="Contenus de la bibliothèque" className="library-tabs">
          <Button
            variant={tab === 'quizzes' ? 'primary' : 'ghost'}
            type="button"
            role="tab"
            id="library-tab-quizzes"
            aria-selected={tab === 'quizzes'}
            aria-controls="library-panel-quizzes"
            tabIndex={tab === 'quizzes' ? 0 : -1}
            onClick={() => setTab('quizzes')}
            onKeyDown={onTabKeyDown}
          >
            Quiz tout prêts
          </Button>
          <Button
            variant={tab === 'questions' ? 'primary' : 'ghost'}
            type="button"
            role="tab"
            id="library-tab-questions"
            aria-selected={tab === 'questions'}
            aria-controls="library-panel-questions"
            tabIndex={tab === 'questions' ? 0 : -1}
            onClick={() => setTab('questions')}
            onKeyDown={onTabKeyDown}
          >
            Questions
          </Button>
        </div>

        {tab === 'quizzes' && (
          <section role="tabpanel" id="library-panel-quizzes" aria-labelledby="library-tab-quizzes">
            {actionError && !previewId && (
              <p className="join-error" role="alert">
                {actionError}
              </p>
            )}
            {quizzesLoading ? (
              <p role="status">Chargement des quiz…</p>
            ) : quizzesError ? (
              <p className="join-error" role="alert">
                {quizzesError}
              </p>
            ) : quizzes.length === 0 ? (
              <p className="ab-empty-state">Aucun quiz ne correspond à ces filtres.</p>
            ) : (
              <ul className="home-cards">
                {quizzes.map((q) => (
                  <li key={q.id} className="home-card-item">
                    <div className="home-card library-card">
                      <span className="home-card__title">{q.title}</span>
                      {q.description && <span className="home-card__desc">{q.description}</span>}
                      <span className="home-card__meta">
                        {formatQuestionCount(q.questionCount)}, {DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty},{' '}
                        {themeLabel(q.theme)}
                      </span>
                      <SourceShort source={q.source} />
                    </div>
                    <div className="library-card-actions">
                      <Button
                        variant="ghost"
                        type="button"
                        id={`library-preview-${q.id}`}
                        aria-label={`Aperçu du quiz ${q.title}`}
                        onClick={() => {
                          setActionError(null)
                          setPreviewId(q.id)
                        }}
                      >
                        Aperçu
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={pending !== null}
                        aria-label={`Personnaliser le quiz ${q.title}`}
                        onClick={() => void handleCustomize(q.id)}
                      >
                        {pending?.id === q.id && pending.action === 'customize' ? 'Création…' : 'Personnaliser'}
                      </Button>
                      <Button
                        variant="primary"
                        type="button"
                        disabled={pending !== null}
                        aria-label={`Jouer maintenant au quiz ${q.title}`}
                        onClick={() => void handlePlay(q.id)}
                      >
                        {pending?.id === q.id && pending.action === 'play' ? 'Lancement…' : 'Jouer maintenant'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'questions' && (
          <div
            className="library-questions"
            role="tabpanel"
            id="library-panel-questions"
            aria-labelledby="library-tab-questions"
          >
            <section aria-label="Questions">
              <div className="host-field">
                <label htmlFor="library-search">Rechercher une question</label>
                <input
                  id="library-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="home-inline-form">
                <div className="host-field">
                  <label htmlFor="library-draw-count">Tirer N questions au hasard</label>
                  <input
                    id="library-draw-count"
                    type="number"
                    min={1}
                    max={DRAW_MAX}
                    value={drawCount}
                    onChange={(e) => setDrawCount(e.target.value)}
                  />
                </div>
                <Button variant="primary" type="button" disabled={drawPending || selectionFull} onClick={() => void handleDraw()}>
                  {drawPending ? 'Tirage…' : 'Tirer'}
                </Button>
                {drawError && (
                  <p className="join-error" role="alert">
                    {drawError}
                  </p>
                )}
                <p role="status">{drawNote}</p>
              </div>

              {questionsLoading ? (
                <p role="status">Chargement des questions…</p>
              ) : questionsError && questions.length === 0 ? (
                <p className="join-error" role="alert">
                  {questionsError}
                </p>
              ) : questions.length === 0 ? (
                <p className="ab-empty-state">Aucune question ne correspond à ces filtres.</p>
              ) : (
                <>
                  {questionsError && (
                    <p className="join-error" role="alert">
                      {questionsError}
                    </p>
                  )}
                  <ul className="home-list">
                    {questions.map((q) => {
                      const checkId = `library-q-${q.id}`
                      return (
                        <li key={q.id} className="home-list__item library-question">
                          <input
                            id={checkId}
                            type="checkbox"
                            checked={selection.some((s) => s.id === q.id)}
                            onChange={() => toggleQuestion(q)}
                          />
                          <label htmlFor={checkId} className="library-question__body">
                            <span className="home-list__meta">
                              {TYPE_LABEL[q.type] ?? q.type}, {DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty}
                            </span>
                            <span className="home-list__title">{q.prompt}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  {questions.length < total && (
                    <Button variant="ghost" type="button" disabled={moreLoading} onClick={() => void loadMore()}>
                      {moreLoading ? 'Chargement…' : 'Afficher plus'}
                    </Button>
                  )}
                  <SourcesNote sources={questions.map((q) => q.source)}>
                    La source exacte de chaque question figure dans l'éditeur, une fois le quiz créé.
                  </SourcesNote>
                </>
              )}
            </section>

            <aside aria-labelledby="library-selection-heading" className="library-selection">
              <h2 id="library-selection-heading">Ma sélection ({selection.length}/{SELECTION_MAX})</h2>
              {selection.length > SELECTION_MAX && (
                <p className="join-error" role="status">
                  Un quiz contient au plus {SELECTION_MAX} questions : retirez-en {selection.length - SELECTION_MAX}.
                </p>
              )}
              {selection.length === 0 ? (
                <p className="ab-empty-state">Cochez ou tirez des questions pour composer un quiz.</p>
              ) : (
                <ol className="home-list">
                  {selection.map((q) => (
                    <li key={q.id} className="home-list__item ab-member-row">
                      <span className="home-list__title">{q.prompt}</span>
                      <Button
                        variant="ghost"
                        type="button"
                        aria-label={`Retirer la question ${q.prompt}`}
                        onClick={() => toggleQuestion(q)}
                      >
                        Retirer
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
              <form className="home-inline-form" onSubmit={(e) => void handleCompose(e)} noValidate>
                {composeError && (
                  <p className="join-error" role="alert">
                    {composeError}
                  </p>
                )}
                <div className="host-field">
                  <label htmlFor="library-title">Titre du quiz</label>
                  <input
                    id="library-title"
                    type="text"
                    required
                    maxLength={TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <Button variant="primary" type="submit" disabled={!canCompose}>
                  {composePending ? 'Création…' : 'Créer le quiz'}
                </Button>
              </form>
            </aside>
          </div>
        )}
      </main>

      {previewId && (
        <LibraryPreview
          quizId={previewId}
          busy={pending?.id === previewId ? pending.action : null}
          error={actionError}
          onClose={closePreview}
          onCustomize={(quiz) => void handleCustomize(quiz.id)}
          onPlay={(quiz) => void handlePlay(quiz.id)}
        />
      )}
    </div>
  )
}
