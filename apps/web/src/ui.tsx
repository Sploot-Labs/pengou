import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import type { AnswerShapeKind } from './constants'

/* ------------------------------------------------------------------ */
/* Logo                                                                 */
/* ------------------------------------------------------------------ */

/**
 * `to` (optionnel) rend le logo cliquable — un `<Link>` vers cette route (ex.
 * `/` pour revenir à l'accueil, le pattern web habituel). À NE PAS fournir sur
 * les surfaces publiques/joueur/scène (Login, Join, PlayerLive, BigScreen) où
 * l'accueil hôte protégé n'a pas de sens et casserait le flux anonyme : sans
 * `to`, le logo reste un simple `<span>` non interactif, comportement d'origine.
 */
export function Logo({ compact = false, to }: { compact?: boolean; to?: string }) {
  const className = `ab-logo${compact ? ' ab-logo--compact' : ''}`
  const content = (
    <>
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
      <span className="ab-logo__text">Pingou</span>
    </>
  )

  if (to) {
    return (
      <Link to={to} className={`${className} ab-logo--link`} aria-label="Pingou, retour à l'accueil">
        {content}
      </Link>
    )
  }
  return <span className={className}>{content}</span>
}

/* ------------------------------------------------------------------ */
/* Mascot — Pingou en position « sploot » (ventre au sol)               */
/* ------------------------------------------------------------------ */

/**
 * Illustration de marque, purement décorative (`aria-hidden`) : elle n'ajoute
 * aucune information, l'identité textuelle reste portée par le logo. Les teintes
 * sont les couleurs de marque Pingou en dur — volontairement indépendantes du
 * thème : la mascotte pose toujours sur sa propre « banquise » (disque clair),
 * donc le pingouin bleu nuit reste lisible aussi bien en clair qu'en sombre.
 * L'oscillation respecte `prefers-reduced-motion` (coupée globalement dans
 * tokens.css ; ici la classe `ab-mascot` ne s'anime que via la règle dédiée).
 */
export function Mascot({ size = 180 }: { size?: number }) {
  return (
    <span className="ab-mascot" aria-hidden="true" style={{ width: size }}>
      <svg viewBox="0 0 320 280" width={size} height={size * (280 / 320)} focusable="false">
        {/* banquise */}
        <ellipse cx="160" cy="214" rx="140" ry="42" fill="#D6F2F9" />
        <ellipse cx="160" cy="226" rx="108" ry="22" fill="#0B2545" opacity="0.08" />
        {/* pattes étalées (le sploot) */}
        <path d="M96 236c-20 6-40 4-46-4 6-12 30-18 50-14z" fill="#FF7A3C" />
        <path d="M224 236c20 6 40 4 46-4-6-12-30-18-50-14z" fill="#FF7A3C" />
        {/* ailerons étalés */}
        <path d="M70 150c-34 6-54 30-52 56 22 6 46-4 66-26z" fill="#0B2545" />
        <path d="M250 150c34 6 54 30 52 56-22 6-46-4-66-26z" fill="#0B2545" />
        {/* corps aplati */}
        <ellipse cx="160" cy="176" rx="94" ry="76" fill="#0B2545" />
        <ellipse cx="160" cy="188" rx="64" ry="60" fill="#F7FBFD" />
        {/* tête */}
        <ellipse cx="160" cy="104" rx="56" ry="50" fill="#0B2545" />
        <ellipse cx="160" cy="116" rx="38" ry="36" fill="#F7FBFD" />
        {/* joues */}
        <circle cx="128" cy="118" r="8" fill="#FF7A3C" opacity="0.5" />
        <circle cx="192" cy="118" r="8" fill="#FF7A3C" opacity="0.5" />
        {/* yeux contents */}
        <path d="M134 104c4-6 12-6 16 0" stroke="#0B2545" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M170 104c4-6 12-6 16 0" stroke="#0B2545" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        {/* bec */}
        <path d="M150 116h20l-10 11z" fill="#FF7A3C" />
        {/* étincelle quiz */}
        <path d="M248 72l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill="#FFC43D" />
      </svg>
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
        <span className="visually-hidden">, réponse {SHAPE_NAME_FR[shape]}</span>
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

/* ------------------------------------------------------------------ */
/* JoinInvite — QR + URL en clair pour rejoindre sans saisir le PIN     */
/* ------------------------------------------------------------------ */

/**
 * Affiché sur le grand écran à côté du PIN : un QR encodant l'URL de jointure
 * (`/join?pin=…`, préremplissage lu par `Join.tsx`) ET l'URL en toutes lettres
 * pour ceux qui préfèrent la taper. Le QR est purement visuel — l'information
 * actionnable reste accessible via le texte de l'URL en dessous ; le `title` du
 * SVG (rendu `role="img"`) donne malgré tout un équivalent aux lecteurs d'écran.
 *
 * `window.location.origin` est l'URL réellement joignable de CE déploiement
 * (self-host ou cloud) — en dev sur `localhost`, le QR n'est pas scannable
 * depuis un mobile distant (résolution locale) : c'est attendu, pas un bug.
 */
export function JoinInvite({ pin, size = 208 }: { pin: string; size?: number }) {
  const joinUrl = `${window.location.origin}/join?pin=${encodeURIComponent(pin)}`
  const displayUrl = `${window.location.host}/join`
  return (
    <div className="join-invite">
      <div className="join-invite__qr">
        <QRCodeSVG
          value={joinUrl}
          size={size}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#0b1220"
          title={`QR code pour rejoindre la partie sur ${displayUrl}`}
        />
      </div>
      <p className="join-invite__hint">
        Scannez pour rejoindre, ou allez sur <strong>{displayUrl}</strong>
      </p>
    </div>
  )
}
