// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WordCloud } from './WordCloud'

afterEach(cleanup)

const words = [
  { key: 'cafe', text: 'café', count: 10 },
  { key: 'the', text: 'thé', count: 1 },
]

describe('WordCloud', () => {
  it('donne le palier le plus grand au mot le plus fréquent et le plus petit à un mot rare', () => {
    render(<WordCloud words={words} />)
    expect(screen.getByText('café').closest('li')).toHaveClass('wordcloud__word--t5')
    expect(screen.getByText('thé').closest('li')).toHaveClass('wordcloud__word--t1')
  })

  it("expose le nombre d'occurrences aux lecteurs d'écran", () => {
    render(<WordCloud words={words} />)
    expect(screen.getByRole('list', { name: 'Nuage de mots' })).toHaveTextContent('café, 10')
  })

  it("n'affiche aucun bouton sans onRemove", () => {
    render(<WordCloud words={words} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('appelle onRemove avec la clé et le texte', () => {
    const onRemove = vi.fn()
    render(<WordCloud words={words} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retirer « café »' }))
    expect(onRemove).toHaveBeenCalledWith({ key: 'cafe', text: 'café' })
  })

  it("affiche le libellé vide quand il n'y a aucun mot", () => {
    render(<WordCloud words={[]} />)
    expect(screen.getByText('En attente des premières idées…')).toBeInTheDocument()
    cleanup()
    render(<WordCloud words={[]} emptyLabel="Rien" />)
    expect(screen.getByText('Rien')).toBeInTheDocument()
  })
})
