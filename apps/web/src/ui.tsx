import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import type { AnswerShapeKind } from './mockData'

/* ------------------------------------------------------------------ */
/* Logo                                                                 */
/* ------------------------------------------------------------------ */

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`ab-logo${compact ? ' ab-logo--compact' : ''}`}>
      {/* Mark = les 4 formes-réponses réunies, pas le seul triangle : évite la
          collision sémantique avec la forme fonctionnelle --ans-triangle. */}
      <span className="ab-logo__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="1em" height="1em" focusable="false">
          <polygon points="7,3 12,11 2,11" fill="var(--ans-triangle)" />
          <polygon points="18,2 23,7 18,12 13,7" fill="var(--ans-diamond)" />
          <circle cx="7" cy="18" r="4.5" fill="var(--ans-circle)" />
          <rect x="14" y="14" width="9" height="9" rx="2" fill="var(--ans-square)" />
        </svg>
      </span>
      <span className="ab-logo__text">Arena</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Button                                                                */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'ghost' | 'success' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  children: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className = '', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={`ab-button ab-button--${variant} ${className}`.trim()} {...rest}>
      {children}
    </button>
  )
})

/* ------------------------------------------------------------------ */
/* AnswerShape — decorative glyph reinforcing shape, never the only cue */
/* ------------------------------------------------------------------ */

export function AnswerShape({ shape, size = 28 }: { shape: AnswerShapeKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    focusable: false as const,
  }

  switch (shape) {
    case 'triangle':
      return (
        <svg {...common}>
          <polygon points="12,3 21,20 3,20" fill="currentColor" />
        </svg>
      )
    case 'diamond':
      return (
        <svg {...common}>
          <polygon points="12,2 22,12 12,22 2,12" fill="currentColor" />
        </svg>
      )
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
        </svg>
      )
    case 'square':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" />
        </svg>
      )
    default:
      return null
  }
}

const SHAPE_TOKEN: Record<AnswerShapeKind, string> = {
  triangle: '--ans-triangle',
  diamond: '--ans-diamond',
  circle: '--ans-circle',
  square: '--ans-square',
}

const SHAPE_INK_TOKEN: Record<AnswerShapeKind, string> = {
  triangle: '--ans-triangle-ink',
  diamond: '--ans-diamond-ink',
  circle: '--ans-circle-ink',
  square: '--ans-square-ink',
}

export const SHAPE_NAME_FR: Record<AnswerShapeKind, string> = {
  triangle: 'triangle',
  diamond: 'losange',
  circle: 'rond',
  square: 'carré',
}

/* ------------------------------------------------------------------ */
/* AnswerTile — real <button>, shape + color + label, never color-only */
/* ------------------------------------------------------------------ */

interface AnswerTileProps {
  shape: AnswerShapeKind
  label: string
  onClick?: () => void
  disabled?: boolean
  selected?: boolean
  /** When set, reveals correctness with icon + text, not color alone. */
  reveal?: 'correct' | 'incorrect' | null
}

export function AnswerTile({ shape, label, onClick, disabled, selected, reveal }: AnswerTileProps) {
  const style = {
    ['--tile-color' as string]: `var(${SHAPE_TOKEN[shape]})`,
    ['--tile-ink' as string]: `var(${SHAPE_INK_TOKEN[shape]})`,
  }

  return (
    <button
      type="button"
      className={`ab-tile${selected ? ' ab-tile--selected' : ''}${reveal ? ` ab-tile--${reveal}` : ''}`}
      style={style}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected ?? undefined}
    >
      <span className="ab-tile__shape">
        <AnswerShape shape={shape} size={32} />
      </span>
      <span className="ab-tile__label">
        {label}
        <span className="visually-hidden"> — réponse {SHAPE_NAME_FR[shape]}</span>
      </span>
      {reveal && (
        <span className="ab-tile__reveal">
          <span aria-hidden="true">{reveal === 'correct' ? '✓' : '✕'}</span>
          <span className="visually-hidden">
            {reveal === 'correct' ? 'Bonne réponse' : 'Réponse incorrecte'}
          </span>
        </span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* TimerRing — SVG ring + always-present textual value                  */
/* ------------------------------------------------------------------ */

interface TimerRingProps {
  remainingSeconds: number
  totalSeconds: number
  size?: number
  /** Projector scale: enlarges the numeric value to match a big-screen ring. */
  large?: boolean
}

export function TimerRing({ remainingSeconds, totalSeconds, size = 96, large = false }: TimerRingProps) {
  const clamped = Math.max(0, Math.min(remainingSeconds, totalSeconds))
  const ratio = totalSeconds > 0 ? clamped / totalSeconds : 0
  const radius = (size - 12) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - ratio)

  // RGAA: aria-live must not spam a screen reader every second. We only
  // update the announced text at meaningful checkpoints (multiples of 5,
  // and every second during the final countdown).
  const [announced, setAnnounced] = useState(clamped)
  const lastAnnounced = useRef(clamped)

  useEffect(() => {
    const shouldAnnounce =
      clamped === totalSeconds || clamped <= 5 || clamped % 5 === 0 || clamped === 0
    if (shouldAnnounce && clamped !== lastAnnounced.current) {
      lastAnnounced.current = clamped
      setAnnounced(clamped)
    }
  }, [clamped, totalSeconds])

  const urgent = clamped <= 5

  return (
    <div className={`ab-timer${urgent ? ' ab-timer--urgent' : ''}${large ? ' ab-timer--xl' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={6}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={urgent ? 'var(--brand)' : 'var(--brand-2)'}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ab-timer__value" aria-hidden="true">
        {clamped}
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {`Temps restant : ${announced} seconde${announced > 1 ? 's' : ''}`}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* PinDisplay — the signature PIN Marquee                               */
/* ------------------------------------------------------------------ */

export function PinDisplay({
  pin,
  label = 'Code PIN de la partie',
  compact = false,
}: {
  pin: string
  label?: string
  /** Smaller marquee for cramped headers (e.g. HostLive) — same signature element, scaled down. */
  compact?: boolean
}) {
  const digits = pin.split('')
  const spaced = digits.join(' ')

  return (
    <div className={`ab-pin${compact ? ' ab-pin--compact' : ''}`}>
      <span className="ab-pin__panel" aria-hidden="true">
        {digits.map((digit, index) => (
          <span className="ab-pin__digit" key={index}>
            {digit}
          </span>
        ))}
        <span className="ab-pin__scanline motion-safe-only" />
      </span>
      <span className="visually-hidden">{`${label} : ${spaced}`}</span>
    </div>
  )
}
