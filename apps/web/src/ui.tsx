import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import type { AnswerShapeKind } from './constants'
import { useT } from './i18n/useT'
import { useSound } from './motion/index.js'
import { t } from './i18n/t'

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
  const { t } = useT()
  const className = `ab-logo${compact ? ' ab-logo--compact' : ''}`
  const content = (
    <>
      {/* Symbole « Croissant » du kit de marque : le pengouin sous-entendu, un
          disque (le dos) + un disque décalé (le ventre) + un bec corail. Les
          teintes dos/ventre suivent les tokens de thème (ink-strong / surface),
          ce qui reproduit le favicon adaptatif : dos foncé sur fond clair, dos
          clair sur fond sombre. Le corail reste réservé au bec (règle d'usage du
          kit : ne jamais recolorer le symbole). */}
      <span className="ab-logo__mark" aria-hidden="true">
        <svg viewBox="12 12 76 76" width="1em" height="1em" focusable="false">
          <circle cx="50" cy="50" r="38" fill="var(--ink-strong)" />
          <circle cx="58" cy="52" r="28" fill="var(--surface)" />
          <path
            fill="var(--accent)"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinejoin="round"
            d="M58 48L76 54L58 60Z"
          />
        </svg>
      </span>
      <span className="ab-logo__text">Pengou</span>
    </>
  )

  if (to) {
    return (
      <Link to={to} className={`${className} ab-logo--link`} aria-label={t("Pengou, retour à l'accueil")}>
        {content}
      </Link>
    )
  }
  return <span className={className}>{content}</span>
}

/* ------------------------------------------------------------------ */
/* Mascot — Pengou en position « sploot » (ventre au sol)               */
/* ------------------------------------------------------------------ */

/**
 * Illustration de marque, purement décorative (`aria-hidden`) : elle n'ajoute
 * aucune information, l'identité textuelle reste portée par le logo. Les teintes
 * sont les couleurs de marque Pengou en dur — volontairement indépendantes du
 * thème : la mascotte pose toujours sur sa propre « banquise » (disque clair),
 * donc le pengouin bleu nuit reste lisible aussi bien en clair qu'en sombre.
 * L'oscillation respecte `prefers-reduced-motion` (coupée globalement dans
 * tokens.css ; ici la classe `ab-mascot` ne s'anime que via la règle dédiée).
 */
export function Mascot({ size = 180 }: { size?: number }) {
  return (
    <span className="ab-mascot" aria-hidden="true" style={{ width: size }}>
      <svg viewBox="0 0 320 280" width={size} height={size * (280 / 320)} focusable="false">
        {/* halo clair derrière le corps : sans lui, le bleu nuit du pengouin
            (#0B2545) se confond avec le fond sombre de la page joueur et
            seuls le ventre, les pattes et le bec restent visibles. */}
        <circle cx="160" cy="150" r="128" fill="#D6F2F9" opacity="0.22" />
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

  // Glyphes « Arcade polaire » : les 4 emplacements de réponse gardent leurs
  // identifiants (triangle/diamond/circle/square) mais sont dessinés en motifs
  // de banquise — étoile, goutte, vague, flocon. Forme + couleur + libellé
  // restent redondants (jamais la couleur seule).
  switch (shape) {
    case 'triangle':
      // Étoile / scintillement à 4 branches.
      return (
        <svg {...common}>
          <path d="M12 1.5 L14.8 9.2 L22.5 12 L14.8 14.8 L12 22.5 L9.2 14.8 L1.5 12 L9.2 9.2 Z" fill="currentColor" />
        </svg>
      )
    case 'diamond':
      // Goutte de glace.
      return (
        <svg {...common}>
          <path d="M12 2 C9 6.5 4.5 11 4.5 15 A7.5 7.5 0 0 0 19.5 15 C19.5 11 15 6.5 12 2 Z" fill="currentColor" />
        </svg>
      )
    case 'circle':
      // Vague / congère.
      return (
        <svg {...common}>
          <path
            d="M2 11 Q4.5 6 7 11 T12 11 T17 11 T22 11 V19.5 Q22 21 20.5 21 H3.5 Q2 21 2 19.5 Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'square':
      // Flocon (astérisque à 6 branches).
      return (
        <svg {...common}>
          <g fill="currentColor">
            <rect x="10.4" y="1.5" width="3.2" height="21" rx="1.6" />
            <rect x="10.4" y="1.5" width="3.2" height="21" rx="1.6" transform="rotate(60 12 12)" />
            <rect x="10.4" y="1.5" width="3.2" height="21" rx="1.6" transform="rotate(-60 12 12)" />
          </g>
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

// Ombre portée pleine par forme (nuance foncée de l'aplat) — relief de touche
// arcade, compressé au clic/sélection (voir .ab-tile dans prototype.css).
const SHAPE_SH_TOKEN: Record<AnswerShapeKind, string> = {
  triangle: '--ans-triangle-sh',
  diamond: '--ans-diamond-sh',
  circle: '--ans-circle-sh',
  square: '--ans-square-sh',
}

// Noms alignés sur les glyphes polaires réellement dessinés (voir AnswerShape) :
// la lecture d'écran décrit la forme vue, pas une géométrie abstraite.
// Accesseurs : le nom suit la langue courante à chaque lecture. Le nom de la constante vient du
// français d'origine, des écrans l'importent encore.
export const SHAPE_NAME_FR: Record<AnswerShapeKind, string> = {
  get triangle() {
    return t('étoile')
  },
  get diamond() {
    return t('goutte')
  },
  get circle() {
    return t('vague')
  },
  get square() {
    return t('flocon')
  },
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
  /** Autre tuile choisie : celle-ci recule (opacité réduite) sans perdre son
   * contraste texte — focus visuel sur le choix validé (maquette QCM). */
  dimmed?: boolean
  /** When set, reveals correctness with icon + text, not color alone. */
  reveal?: 'correct' | 'incorrect' | null
}

export function AnswerTile({ shape, label, onClick, disabled, selected, dimmed, reveal }: AnswerTileProps) {
  const { t } = useT()
  const style = {
    ['--tile-color' as string]: `var(${SHAPE_TOKEN[shape]})`,
    ['--tile-ink' as string]: `var(${SHAPE_INK_TOKEN[shape]})`,
    ['--tile-shadow' as string]: `var(${SHAPE_SH_TOKEN[shape]})`,
  }

  return (
    <button
      type="button"
      className={`ab-tile${selected ? ' ab-tile--selected' : ''}${dimmed ? ' ab-tile--dim' : ''}${reveal ? ` ab-tile--${reveal}` : ''}`}
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
        <span className="visually-hidden">{t(', réponse {shape}', { shape: SHAPE_NAME_FR[shape] })}</span>
      </span>
      {reveal && (
        <span className="ab-tile__reveal">
          <span aria-hidden="true">{reveal === 'correct' ? '✓' : '✕'}</span>
          <span className="visually-hidden">{reveal === 'correct' ? t('Bonne réponse') : t('Réponse incorrecte')}</span>
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
  const { tp } = useT()
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
    const shouldAnnounce = clamped === totalSeconds || clamped <= 5 || clamped % 5 === 0 || clamped === 0
    if (shouldAnnounce && clamped !== lastAnnounced.current) {
      lastAnnounced.current = clamped
      setAnnounced(clamped)
    }
  }, [clamped, totalSeconds])

  const urgent = clamped <= 5

  return (
    <div className={`ab-timer${urgent ? ' ab-timer--urgent' : ''}${large ? ' ab-timer--xl' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={6} />
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
        {tp(announced, 'Temps restant : {n} seconde', 'Temps restant : {n} secondes')}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* TimerPill — compteur mm:ss (vue joueur en question)                  */
/* ------------------------------------------------------------------ */

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/**
 * Pastille minuteur de la vue joueur « au pouce » : chiffre mm:ss en DM Mono,
 * passage à l'état urgent (couleur de marque) dans les 5 dernières secondes.
 * L'annonce lecteur d'écran est volontairement throttlée (mêmes points de
 * contrôle que `TimerRing` : multiples de 5 et chaque seconde du sprint final)
 * pour ne pas marteler l'`aria-live` à chaque tick.
 */
export function TimerPill({ remainingSeconds, totalSeconds }: { remainingSeconds: number; totalSeconds: number }) {
  const { tp } = useT()
  const clamped = Math.max(0, Math.min(remainingSeconds, totalSeconds))
  const [announced, setAnnounced] = useState(clamped)
  const lastAnnounced = useRef(clamped)

  useEffect(() => {
    const shouldAnnounce = clamped === totalSeconds || clamped <= 5 || clamped % 5 === 0 || clamped === 0
    if (shouldAnnounce && clamped !== lastAnnounced.current) {
      lastAnnounced.current = clamped
      setAnnounced(clamped)
    }
  }, [clamped, totalSeconds])

  const urgent = clamped <= 5

  return (
    <span className={`ab-timerpill${urgent ? ' ab-timerpill--urgent' : ''}`}>
      <span aria-hidden="true">{formatClock(clamped)}</span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {tp(announced, 'Temps restant : {n} seconde', 'Temps restant : {n} secondes')}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* PinDisplay — the signature PIN Marquee                               */
/* ------------------------------------------------------------------ */

export function PinDisplay({
  pin,
  label,
  compact = false,
}: {
  pin: string
  label?: string
  /** Smaller marquee for cramped headers (e.g. HostLive) — same signature element, scaled down. */
  compact?: boolean
}) {
  const { t } = useT()
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
      <span className="visually-hidden">
        {t('{label} : {pin}', { label: label ?? t('Code PIN de la partie'), pin: spaced })}
      </span>
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
  const { t } = useT()
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
          title={t('QR code pour rejoindre la partie sur {url}', { url: displayUrl })}
        />
      </div>
      <p className="join-invite__hint">
        {t('Scannez pour rejoindre, ou allez sur')} <strong>{displayUrl}</strong>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SoundToggle — bouton haut-parleur (coupe/active le son)              */
/* ------------------------------------------------------------------ */

/**
 * Bouton son partagé par les deux écrans de jeu (joueur et grand écran). Le
 * clic sert AUSSI de geste de déverrouillage audio (`sound.unlock()`), utile
 * surtout sur le grand écran, écran passif sans autre contrôle. L'état muet
 * vit dans le `SoundManager` (persisté en localStorage) ; on le reflète dans
 * un état local pour redessiner l'icône, le `SoundManager` n'étant pas réactif.
 */
export function SoundToggle({ className = '' }: { className?: string }) {
  const sound = useSound()
  const { t } = useT()
  const [muted, setMuted] = useState(() => sound.muted)

  function toggle() {
    sound.unlock()
    const next = !muted
    sound.setMuted(next)
    setMuted(next)
  }

  return (
    <button
      type="button"
      className={`ab-soundtoggle ${className}`.trim()}
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? t('Activer le son') : t('Couper le son')}
      title={muted ? t('Activer le son') : t('Couper le son')}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        ) : (
          <>
            <path d="M16 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            <path
              d="M18.5 6a8.5 8.5 0 0 1 0 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </>
        )}
      </svg>
      <span className="visually-hidden">{muted ? t('Son coupé') : t('Son activé')}</span>
    </button>
  )
}
