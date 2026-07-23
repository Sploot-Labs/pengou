import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Enveloppe le switch de phase : sortie/entrée en crossfade. Framer Motion est
 * ISOLÉ ici (aucun écran ne l'importe). Ne touche pas au focus : les écrans
 * gardent la main via leurs headingRef (RGAA 2.4.3). */
export function PhaseTransition({ phaseKey, children }: { phaseKey: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 0.35
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phaseKey}
        initial={{ opacity: reduced ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: reduced ? 1 : 0 }}
        transition={{ duration }}
        style={{ height: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
