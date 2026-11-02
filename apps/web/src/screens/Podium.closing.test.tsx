// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ClosingView } from './Podium'

describe('ClosingView', () => {
  afterEach(cleanup)

  it('salue la salle avec « Merci pour vos réponses » et le titre du quiz', () => {
    render(<ClosingView audience="room" quizTitle="Quiz Test" />)
    expect(screen.getByRole('heading', { name: 'Merci pour vos réponses' })).toBeInTheDocument()
    expect(screen.getByText('Quiz Test')).toBeInTheDocument()
  })

  it('tutoie le joueur avec « Merci pour tes réponses »', () => {
    render(<ClosingView audience="player" />)
    expect(screen.getByRole('heading', { name: 'Merci pour tes réponses' })).toBeInTheDocument()
    expect(screen.queryByText('Quiz Test')).toBeNull()
  })
})
