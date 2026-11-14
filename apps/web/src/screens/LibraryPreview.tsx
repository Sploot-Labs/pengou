import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError } from '../api/client'
import { getLibraryQuiz, type LibraryQuestion, type LibraryQuizSummary } from '../api/library'
import type { McqPayload, SliderPayload, TextPayload, TrueFalsePayload } from '../api/quizzes'
import { Button } from '../ui'
import { QuizLimitNotice } from '../ui/QuizLimitNotice'
import { SourceCredit } from '../ui/SourceCredit'
import { t, tp } from '../i18n/t'
import { useT } from '../i18n/useT'

/** Libellé d'un type de question ; le type brut en repli. */
export function typeLabel(type: string): string {
  switch (type) {
    case 'mcq':
      return t('Choix multiple')
    case 'truefalse':
      return t('Vrai ou faux')
    case 'text':
      return t('Réponse libre')
    case 'slider':
      return t('Curseur')
    case 'wordcloud':
      return t('Nuage de mots')
    case 'poll':
      return t('Sondage')
    default:
      return type
  }
}

/** Bonne réponse en une ligne, selon le type. Payload inattendu : rien plutôt qu'un plantage. */
export function answerText(q: Pick<LibraryQuestion, 'type' | 'payload'>): string | null {
  switch (q.type) {
    case 'mcq': {
      const labels = ((q.payload as McqPayload).options ?? []).filter((o) => o.correct).map((o) => o.label)
      return labels.length > 0 ? t('Réponse : {answer}', { answer: labels.join(t(' ou ')) }) : null
    }
    case 'truefalse': {
      const correct = (q.payload as TrueFalsePayload).correct
      return typeof correct === 'boolean' ? t('Réponse : {answer}', { answer: correct ? t('vrai') : t('faux') }) : null
    }
    case 'text': {
      const answers = (q.payload as TextPayload).answers ?? []
      if (answers.length === 0) return null
      return answers.length === 1
        ? t('Réponse : {answer}', { answer: answers[0] })
        : t('Réponses acceptées : {answers}', { answers: answers.join(', ') })
    }
    case 'slider': {
      const p = q.payload as SliderPayload
      return typeof p.correct === 'number'
        ? t('Réponse : {value} (entre {min} et {max})', { value: p.correct, min: p.min, max: p.max })
        : null
    }
    default:
      return null
  }
}

/**
 * Aperçu d'un quiz tout prêt : la liste de ses questions, réponses masquées par défaut, avant de le
 * personnaliser ou d'y jouer. Boîte modale accessible (focus piégé, Échap ferme, focus rendu au
 * bouton d'origine par l'appelant).
 */
export function LibraryPreview({
  quizId,
  busy,
  error: actionError,
  quizLimit = false,
  onClose,
  onCustomize,
  onPlay,
}: {
  quizId: string
  busy: 'customize' | 'play' | null
  /** Échec de « Personnaliser » ou « Jouer maintenant », affiché dans la boîte plutôt que derrière. */
  error: string | null
  /** L'échec est le refus de création faute d'adresse confirmée : on propose le renvoi de l'e-mail. */
  quizLimit?: boolean
  onClose: () => void
  onCustomize: (quiz: LibraryQuizSummary) => void
  onPlay: (quiz: LibraryQuizSummary) => void
}) {
  useT()
  const [data, setData] = useState<{ quiz: LibraryQuizSummary; questions: LibraryQuestion[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAnswers, setShowAnswers] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let stale = false
    setData(null)
    setError(null)
    getLibraryQuiz(quizId)
      .then((res) => {
        if (!stale) setData(res)
      })
      .catch((err) => {
        if (!stale) setError(err instanceof ApiError ? err.message : t('Une erreur réseau est survenue. Réessayez.'))
      })
    return () => {
      stale = true
    }
  }, [quizId])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')
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
  }

  const quiz = data?.quiz

  return (
    <div className="host-dialog__backdrop">
      <div
        className="host-dialog library-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-preview-title"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="library-preview__head">
          <div>
            <h2 id="library-preview-title">{quiz?.title ?? t('Aperçu du quiz')}</h2>
            {data && (
              <span className="home-card__meta">{tp(data.questions.length, '{n} question', '{n} questions')}</span>
            )}
          </div>
          <Button variant="ghost" type="button" ref={closeRef} onClick={onClose}>
            {t('Fermer')}
          </Button>
        </div>

        {error ? (
          <p className="join-error" role="alert">
            {error}
          </p>
        ) : !data ? (
          <p role="status">{t('Chargement des questions…')}</p>
        ) : (
          <>
            <Button variant="ghost" type="button" aria-pressed={showAnswers} onClick={() => setShowAnswers((v) => !v)}>
              {showAnswers ? t('Masquer les réponses') : t('Afficher les réponses')}
            </Button>
            <ol className="library-preview__list">
              {data.questions.map((q) => {
                const answer = showAnswers ? answerText(q) : null
                return (
                  <li key={q.id} className="library-preview__item">
                    <span className="library-preview__prompt">
                      <span>{q.prompt}</span>
                      <span className="host-badge">{typeLabel(q.type)}</span>
                    </span>
                    {answer && <span className="library-preview__answer">{answer}</span>}
                  </li>
                )
              })}
            </ol>
            <p className="source-credit">
              <SourceCredit source={data.quiz.source} />
            </p>
          </>
        )}

        {actionError &&
          (quizLimit ? (
            <QuizLimitNotice />
          ) : (
            <p className="join-error" role="alert">
              {actionError}
            </p>
          ))}
        <div className="host-dialog__actions">
          <Button
            variant="ghost"
            type="button"
            disabled={!quiz || busy !== null}
            onClick={() => quiz && onCustomize(quiz)}
          >
            {busy === 'customize' ? t('Création…') : t('Personnaliser')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!quiz || busy !== null}
            onClick={() => quiz && onPlay(quiz)}
          >
            {busy === 'play' ? t('Lancement…') : t('Jouer maintenant')}
          </Button>
        </div>
      </div>
    </div>
  )
}
