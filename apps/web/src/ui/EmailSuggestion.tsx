import { suggestEmailDomain } from '@splootlabs/shared/email-suggest'
import { useT } from '../i18n/useT'

interface EmailSuggestionProps {
  /** Valeur courante du champ e-mail (la suggestion se calcule dessus). */
  value: string
  /** Appelé avec l'adresse corrigée quand l'utilisateur accepte la suggestion. */
  onApply: (value: string) => void
}

/**
 * Aide à la saisie : propose « Vouliez-vous dire camille@gmail.com ? ». À placer sous le champ, avec
 * `value` mis à jour à la perte de focus seulement. La région `aria-live` reste montée en permanence
 * pour que l'apparition de la suggestion soit annoncée.
 */
export function EmailSuggestion({ value, onApply }: EmailSuggestionProps) {
  const { t } = useT()
  const suggestion = suggestEmailDomain(value.trim())
  return (
    <div aria-live="polite" className="join-suggestion">
      {suggestion && (
        <p>
          {t('Vouliez-vous dire')}{' '}
          <button type="button" className="join-suggestion__apply" onClick={() => onApply(suggestion)}>
            {suggestion}
          </button>
          {t(' ?')}
        </p>
      )}
    </div>
  )
}
