import { Children, isValidElement, type ReactNode } from 'react'
import { Reveal } from './Reveal.js'

/** Révèle chaque enfant direct avec un délai croissant (`index * step` ms).
 * En reduced-motion, Reveal rend tout immédiatement (aucun délai appliqué). */
export function Stagger({ step = 60, children }: { step?: number; children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) =>
        isValidElement(child) ? (
          <Reveal key={child.key ?? i} delay={i * step}>
            {child}
          </Reveal>
        ) : (
          child
        ),
      )}
    </>
  )
}
