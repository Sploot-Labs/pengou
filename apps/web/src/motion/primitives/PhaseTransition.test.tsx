// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { PhaseTransition } from './PhaseTransition.js'
import { Confetti } from './Confetti.js'

describe('PhaseTransition', () => {
  it('rend le contenu de la phase courante', () => {
    render(
      <MotionProvider>
        <PhaseTransition phaseKey="question">
          <p>question en cours</p>
        </PhaseTransition>
      </MotionProvider>,
    )
    expect(screen.getByText('question en cours')).toBeDefined()
  })
})

describe('Confetti', () => {
  it('ne monte aucun canvas quand inactif', () => {
    const { container } = render(
      <MotionProvider>
        <Confetti active={false} />
      </MotionProvider>,
    )
    expect(container.querySelector('canvas')).toBeNull()
  })
})
