// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { CountUp } from './CountUp.js'

function withRM(matches: boolean) {
  window.matchMedia = (q: string) =>
    ({ matches, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
}

describe('CountUp', () => {
  it('affiche directement la valeur finale en reduced-motion', () => {
    withRM(true)
    render(
      <MotionProvider>
        <CountUp value={1250} format={(n) => `${n} pts`} />
      </MotionProvider>,
    )
    expect(screen.getByText('1250 pts')).toBeDefined()
  })
})
