// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { AnimatedBar } from './AnimatedBar.js'

describe('AnimatedBar', () => {
  it('exprime la proportion value/max en scaleY', () => {
    const { container } = render(
      <MotionProvider>
        <AnimatedBar value={3} max={6} color="var(--brand)" />
      </MotionProvider>,
    )
    const bar = container.querySelector('[data-bar]') as HTMLElement
    expect(bar.style.getPropertyValue('--bar-scale')).toBe('0.5')
  })

  it('borne le ratio à 1 même si value > max', () => {
    const { container } = render(
      <MotionProvider>
        <AnimatedBar value={10} max={4} color="var(--brand)" />
      </MotionProvider>,
    )
    const bar = container.querySelector('[data-bar]') as HTMLElement
    expect(bar.style.getPropertyValue('--bar-scale')).toBe('1')
  })
})
