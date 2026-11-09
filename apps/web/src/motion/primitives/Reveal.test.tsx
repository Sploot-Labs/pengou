// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { Reveal } from './Reveal.js'

describe('Reveal', () => {
  it('rend son contenu immédiatement (présent dans le DOM)', () => {
    window.matchMedia = (q: string) =>
      ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    render(
      <MotionProvider>
        <Reveal>coucou</Reveal>
      </MotionProvider>,
    )
    expect(screen.getByText('coucou')).toBeDefined()
  })

  it("n'applique aucune animation inline en reduced-motion", () => {
    window.matchMedia = (q: string) =>
      ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    render(
      <MotionProvider>
        <Reveal>salut</Reveal>
      </MotionProvider>,
    )
    const el = screen.getByText('salut')
    expect(el.style.animation).toBeFalsy()
  })
})
