import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Enveloppe le switch de phase : sortie/entrée en crossfade. Framer Motion est
 * ISOLÉ ici (aucun écran ne l'importe). Ne touche pas au focus : les écrans
 * gardent la main via leurs headingRef (RGAA 2.4.3) — voir `useFocusOnMount`,
 * qui focalise au MONTAGE réel du contenu (donc après la sortie, avec
 * `mode="wait"`), plutôt que sur le changement d'état `phase`. */
export function PhaseTransition({
  phaseKey,
  className,
  children,
}: {
  phaseKey: string
  className?: string
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 0.35
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phaseKey}
        className={className}
        initial={{ opacity: reduced ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: reduced ? 1 : 0 }}
        transition={{ duration }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
