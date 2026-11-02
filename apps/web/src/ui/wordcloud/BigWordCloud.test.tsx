// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BigWordCloud } from './BigWordCloud'
import { hashKey } from './layout'

afterEach(cleanup)

const base = { revealed: false, reducedMotion: false }
const cafe = { key: 'cafe', text: 'café', count: 3 }
const the = { key: 'the', text: 'thé', count: 1 }

describe('BigWordCloud', () => {
  it('affiche le libellé vide sans mot', () => {
    render(<BigWordCloud {...base} words={[]} />)
    expect(screen.getByText('En attente des premières idées…')).toBeTruthy()
  })

  it('affiche chaque mot une seule fois en texte visible', () => {
    render(<BigWordCloud {...base} words={[cafe, the]} />)
    expect(screen.getByText('café')).toBeTruthy()
    expect(screen.getByText('thé')).toBeTruthy()
  })

  it('expose une liste accessible « Nuage de mots »', () => {
    render(<BigWordCloud {...base} words={[cafe, the]} />)
    expect(screen.getByRole('list', { name: 'Nuage de mots' })).toHaveTextContent('café, 3')
  })

  it("cache les mots dessinés aux lecteurs d'écran", () => {
    render(<BigWordCloud {...base} words={[cafe]} />)
    expect(screen.getByText('café').closest('.bigcloud__stage')).toHaveAttribute('aria-hidden', 'true')
  })

  it('applique la classe de couleur dérivée de la clé', () => {
    render(<BigWordCloud {...base} words={[cafe]} />)
    const word = screen.getByText('café').closest('.bigcloud__word')
    expect(word).toHaveClass(`bigcloud__word--c${hashKey('cafe') % 7}`)
  })

  it('marque le mot de tête', () => {
    render(<BigWordCloud {...base} words={[cafe, the]} />)
    expect(screen.getByText('café').closest('.bigcloud__word')).toHaveAttribute('data-top', 'true')
    expect(screen.getByText('thé').closest('.bigcloud__word')).toHaveAttribute('data-top', 'false')
  })

  it('passe en mode immobile en reduced-motion', () => {
    const { container } = render(<BigWordCloud {...base} reducedMotion words={[cafe]} />)
    expect(container.firstElementChild).toHaveClass('bigcloud--still')
  })

  it("fige le premier mot reçu comme firstKey même s'il est dépassé", () => {
    // Clé dont le hachage la rendrait verticale sans le forçage horizontal.
    let key = 'a'
    for (let i = 0; hashKey(key) % 10 >= 3; i++) key = `mot${i}`
    const first = { key, text: key, count: 1 }
    const { rerender } = render(<BigWordCloud {...base} words={[first]} />)
    rerender(<BigWordCloud {...base} words={[first, { key: 'zz', text: 'zz', count: 5 }]} />)
    expect(screen.getByText(key).closest('.bigcloud__word')).toHaveAttribute('data-vertical', 'false')
  })
})
