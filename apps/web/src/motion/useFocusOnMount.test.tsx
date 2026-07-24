// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFocusOnMount } from './useFocusOnMount.js'

// La clé est posée sur le <h1> lui-même (pas sur `Heading`) : c'est le
// titre qui doit démonter/remonter d'une phase à l'autre, alors que le hook
// (et son état « premier montage ») appartient à un composant qui, lui,
// reste monté tout du long — exactement le rapport entre <PhaseTransition>
// (qui démonte/remonte le contenu de la phase) et BigScreenInner (qui, lui,
// ne démonte jamais).
function Heading({ k }: { k: string }) {
  const cb = useFocusOnMount<HTMLHeadingElement>()
  return (
    <h1 key={k} ref={cb} tabIndex={-1}>
      {k}
    </h1>
  )
}

describe('useFocusOnMount', () => {
  it('ne focalise pas le tout premier montage, puis focalise le nouveau titre après un remontage (changement de clé)', () => {
    const { rerender } = render(<Heading k="a" />)
    expect(document.activeElement).not.toBe(screen.getByText('a'))

    rerender(<Heading k="b" />)
    expect(document.activeElement).toBe(screen.getByText('b'))
  })
})
