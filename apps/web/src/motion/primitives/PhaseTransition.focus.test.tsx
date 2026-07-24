// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { useFocusOnMount } from '../useFocusOnMount.js'
import { PhaseTransition } from './PhaseTransition.js'

// Ce fichier a plusieurs `it` qui rendent des titres au texte identique
// ("titre question" réapparaît d'un test à l'autre) — sans ce nettoyage,
// les DOM de tests successifs s'accumuleraient dans le même `document`
// (aucun cleanup global n'est configuré dans ce dépôt, voir vitest.setup.ts)
// et `getByText` échouerait pour trouvaille multiple.
afterEach(cleanup)

/**
 * Test d'INTÉGRATION : reproduit le rapport réel entre BigScreenInner (jamais
 * démonté) et <PhaseTransition> (démonte/remonte le contenu de phase). Ni
 * `useFocusOnMount.test.tsx` (le hook seul, sans AnimatePresence) ni
 * `PhaseTransition.test.tsx` (une seule phase, jamais de swap) ne couvrent la
 * revendication centrale : sous `mode="wait"`, la NOUVELLE tête de phase
 * monte bien et reçoit le focus.
 *
 * `focusHeading` est déclaré UNE SEULE FOIS dans `Screen` (comme
 * `focusPhaseHeading` dans BigScreenInner) — le composant `Screen` ne
 * démonte jamais, seul son enfant (le titre, à l'intérieur de
 * <PhaseTransition>) démonte/remonte au changement de `phase`.
 */

type Phase = 'lobby' | 'question' | 'podium'

function Screen({ phase }: { phase: Phase }) {
  const focusHeading = useFocusOnMount<HTMLHeadingElement>()
  return (
    <PhaseTransition phaseKey={phase}>
      {phase === 'lobby' && (
        <h1 ref={focusHeading} tabIndex={-1}>
          titre lobby
        </h1>
      )}
      {phase === 'question' && (
        <h1 ref={focusHeading} tabIndex={-1}>
          titre question
        </h1>
      )}
      {phase === 'podium' && (
        <h1 ref={focusHeading} tabIndex={-1}>
          titre podium
        </h1>
      )}
    </PhaseTransition>
  )
}

function withReducedMotion(matches: boolean) {
  // framer-motion lit sa propre préférence reduced-motion via l'API DEPRECATED
  // `addListener`/`removeListener` (pas seulement `addEventListener`, utilisée
  // par MotionProvider) — les deux doivent être présentes ou son montage lève.
  window.matchMedia = ((q: string) =>
    ({
      matches,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList)
}

describe('PhaseTransition + useFocusOnMount (intégration, mode="wait")', () => {
  it('le swap de phase focalise le nouveau titre, y compris un montage tardif (podium)', async () => {
    withReducedMotion(false)
    const { rerender } = render(
      <MotionProvider>
        <Screen phase="lobby" />
      </MotionProvider>,
    )
    // Premier montage : jamais focalisé.
    expect(document.activeElement).not.toBe(screen.getByText('titre lobby'))

    rerender(
      <MotionProvider>
        <Screen phase="question" />
      </MotionProvider>,
    )
    // La sortie du titre lobby (AnimatePresence mode="wait") est asynchrone :
    // le titre question ne monte (et n'est focalisé) qu'une fois celle-ci
    // résolue — d'où l'attente via waitFor plutôt qu'une assertion immédiate.
    await waitFor(() => expect(screen.queryByText('titre lobby')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('titre question')))

    rerender(
      <MotionProvider>
        <Screen phase="podium" />
      </MotionProvider>,
    )
    await waitFor(() => expect(screen.queryByText('titre question')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('titre podium')))
  })

  it('reduced motion : le swap monte et focalise quand même le nouveau titre (duration 0, exit no-op)', async () => {
    withReducedMotion(true)
    const { rerender } = render(
      <MotionProvider>
        <Screen phase="lobby" />
      </MotionProvider>,
    )
    expect(document.activeElement).not.toBe(screen.getByText('titre lobby'))

    rerender(
      <MotionProvider>
        <Screen phase="question" />
      </MotionProvider>,
    )
    await waitFor(() => expect(screen.queryByText('titre lobby')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('titre question')))
  })

  it("un re-rendu à `phaseKey` INCHANGÉE ne refocalise pas (callback memoïsée)", async () => {
    withReducedMotion(false)
    const { rerender } = render(
      <MotionProvider>
        <Screen phase="lobby" />
      </MotionProvider>,
    )

    rerender(
      <MotionProvider>
        <Screen phase="question" />
      </MotionProvider>,
    )
    await waitFor(() => expect(screen.queryByText('titre lobby')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('titre question')))

    // Simule BigScreenInner qui re-rend toutes les 250ms (effet chrono) sans
    // que `phase` change : si la callback ref n'était pas mémoïsée
    // (`useCallback` avec deps `[]`), React lui donnerait une IDENTITÉ
    // nouvelle à chaque rendu, ce qui la ré-invoquerait avec le même nœud —
    // et volerait le focus à chaque tick, même après que l'utilisateur (ou,
    // ici, le test) l'ait explicitement rendu ailleurs.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)

    rerender(
      <MotionProvider>
        <Screen phase="question" />
      </MotionProvider>,
    )
    expect(document.activeElement).toBe(document.body)
  })
})
