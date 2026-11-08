import { useState } from 'react'
import { AnswerTile } from '../ui'

const SHAPES = ['triangle', 'diamond', 'circle', 'square'] as const

interface PlayerPollProps {
  options: { label: string }[]
  multiple: boolean
  disabled: boolean
  /** Indices du vote déjà envoyé (vide si rien n'a été validé). */
  selected: number[]
  onSubmit: (optionIndexes: number[]) => void
}

/**
 * Saisie d'un sondage. Choix unique : un appui vote. Choix multiple : les
 * tuiles basculent un état coché, « Valider » envoie les indices triés.
 */
export function PlayerPoll({ options, multiple, disabled, selected, onSubmit }: PlayerPollProps) {
  const [draft, setDraft] = useState<number[]>([])
  const shown = disabled ? selected : draft

  function toggle(index: number) {
    setDraft((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index]))
  }

  return (
    <>
      {multiple && <p className="player-commit-hint">Plusieurs réponses possibles</p>}
      {/* biome-ignore lint/a11y/useSemanticElements: même conteneur de tuiles que le QCM */}
      <div className="player-tiles" role="group" aria-label="Réponses">
        {options.map((opt, index) => (
          <AnswerTile
            key={index}
            shape={SHAPES[index % SHAPES.length]}
            label={opt.label}
            selected={multiple ? shown.includes(index) : disabled && selected.includes(index)}
            dimmed={disabled && selected.length > 0 && !selected.includes(index)}
            disabled={disabled}
            onClick={() => (multiple ? toggle(index) : onSubmit([index]))}
          />
        ))}
      </div>
      {multiple && (
        <button
          type="button"
          className="player-cta"
          disabled={disabled || draft.length === 0}
          onClick={() => onSubmit([...draft].sort((a, b) => a - b))}
        >
          Valider
        </button>
      )}
    </>
  )
}
