import { useCallback, useRef } from 'react'

/**
 * Callback ref qui met le focus sur l'élément AU MOMENT où il monte réellement
 * dans le DOM — et non sur un changement d'état qui peut précéder le montage.
 *
 * C'est le pendant accessibilité de <PhaseTransition> : avec AnimatePresence
 * mode="wait", le contenu de la nouvelle phase ne monte qu'une fois la sortie
 * de l'ancienne terminée (~350 ms). Un `useEffect(..., [phase])` focaliserait
 * donc l'ANCIEN titre (encore monté), puis le perdrait au démontage — le focus
 * retomberait sur <body> (RGAA 2.4.3 cassé). En liant le focus au montage, la
 * temporisation de l'animation n'a plus d'importance.
 *
 * Le tout premier montage n'est jamais focalisé.
 */
export function useFocusOnMount<T extends HTMLElement>(): (node: T | null) => void {
  const isFirst = useRef(true)
  return useCallback((node: T | null) => {
    if (!node) return
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    node.focus()
  }, [])
}
