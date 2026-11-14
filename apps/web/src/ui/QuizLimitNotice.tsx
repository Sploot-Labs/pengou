import { useSession } from '../api/auth'
import { ApiError } from '../api/client'
import { useT } from '../i18n/useT'
import { useResendVerification } from './useResendVerification'

export const QUIZ_LIMIT_CODE = 'email_unverified_quiz_limit'

/** Vrai si le serveur refuse la création parce que l'adresse n'est pas confirmée. */
export function isQuizLimitError(err: unknown): boolean {
  return err instanceof ApiError && err.code === QUIZ_LIMIT_CODE
}

/** Message de refus de création de quiz, avec renvoi de l'e-mail de confirmation sur place. */
export function QuizLimitNotice() {
  const { user } = useSession()
  const { t } = useT()
  const { state, error, resend } = useResendVerification(user?.email)
  return (
    <div className="join-error ab-quiz-limit" role="alert">
      <p>{t("Confirmez votre adresse e-mail pour créer d'autres quiz.")}</p>
      <button
        type="button"
        className="ab-verify-banner__action"
        disabled={state === 'sending'}
        onClick={() => void resend()}
      >
        {t("Renvoyer l'e-mail")}
      </button>
      <span role="status">{state === 'sent' ? ` ${t('E-mail envoyé')}` : ''}</span>
      {error && <p>{error}</p>}
    </div>
  )
}
