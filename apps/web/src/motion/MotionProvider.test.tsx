// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionProvider } from './MotionProvider.js'
import { useCue } from './useCue.js'
import { registry } from './registry.js'

function Emit({ cue }: { cue: string }) {
  const fire = useCue()
  useEffect(() => {
    fire(cue as never)
  }, [cue, fire])
  return null
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  // Isolation : les tests qui polluent le registre partagé ou window.matchMedia
  // ne doivent jamais laisser de résidu, même si une assertion a levé avant leur nettoyage local.
  delete registry['test.ping']
  delete registry['test.rm']
  window.matchMedia = originalMatchMedia
})

describe('moteur de cues', () => {
  it('un cue non enregistré est un no-op (ne lève pas)', () => {
    expect(() =>
      render(
        <MotionProvider>
          <Emit cue="inconnu.total" />
        </MotionProvider>,
      ),
    ).not.toThrow()
  })

  it("joue l'animation d'un cue enregistré", () => {
    const spy = vi.fn()
    registry['test.ping'] = { animation: spy }
    render(
      <MotionProvider>
        <Emit cue="test.ping" />
      </MotionProvider>,
    )
    expect(spy).toHaveBeenCalledOnce()
  })

  it("saute l'animation en reduced-motion mais laisse le cue passer", () => {
    window.matchMedia = (q: string) =>
      ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    const anim = vi.fn()
    registry['test.rm'] = { animation: anim, reducedMotion: 'skip' }
    render(
      <MotionProvider>
        <Emit cue="test.rm" />
      </MotionProvider>,
    )
    expect(anim).not.toHaveBeenCalled()
  })
})
