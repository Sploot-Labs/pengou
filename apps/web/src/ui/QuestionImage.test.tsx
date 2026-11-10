// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { QuestionImage } from './QuestionImage'

describe('QuestionImage', () => {
  afterEach(cleanup)

  it('ne rend rien sans src', () => {
    render(<QuestionImage variant="player" />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('ne rend rien avec un src vide ou null', () => {
    const { rerender } = render(<QuestionImage src="" variant="player" />)
    expect(screen.queryByRole('img')).toBeNull()
    rerender(<QuestionImage src={null} variant="player" />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it("rend l'image avec son texte alternatif et la classe de variante", () => {
    render(<QuestionImage src="https://ok.example/a.png" alt="Un manchot" variant="host" />)
    const img = screen.getByRole('img', { name: 'Un manchot' })
    expect(img).toHaveAttribute('src', 'https://ok.example/a.png')
    expect(img).toHaveClass('question-image', 'question-image--host')
  })

  it("disparaît si l'image ne charge pas", () => {
    render(<QuestionImage src="https://mort.example/a.png" alt="x" variant="big" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
  })

  it("l'erreur est réinitialisée quand la clé src change chez l'appelant", () => {
    const { rerender } = render(<QuestionImage key="a" src="https://mort.example/a.png" alt="x" variant="big" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    rerender(<QuestionImage key="b" src="https://ok.example/b.png" alt="x" variant="big" />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
