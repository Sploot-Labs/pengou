// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BigWordCloud } from './BigWordCloud'
import { hashKey } from './layout'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

  describe('moment de fin', () => {
    const five = [
      { key: 'a', text: 'a', count: 9 },
      { key: 'b', text: 'b', count: 7 },
      { key: 'c', text: 'c', count: 5 },
      { key: 'd', text: 'd', count: 3 },
      { key: 'e', text: 'e', count: 1 },
    ]
    const wordEl = (t: string) =>
      screen.getByText(t, { selector: '.bigcloud__text' }).closest('.bigcloud__word') as HTMLElement
    const badges = (c: HTMLElement) => Array.from(c.querySelectorAll('.bigcloud__badge'))
    const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

    it('allume le top 4 et éteint le reste à la révélation', () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} words={five} />)
      rerender(<BigWordCloud {...base} revealed words={five} />)
      expect(container.firstElementChild).toHaveClass('bigcloud--revealed')
      for (const k of ['a', 'b', 'c', 'd']) expect(wordEl(k)).toHaveAttribute('data-lit', 'true')
      expect(wordEl('e')).not.toHaveAttribute('data-lit')
    })

    it('fait arriver les pastilles de la 4e à la 1re', () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} words={five} />)
      advance(2000)
      rerender(<BigWordCloud {...base} revealed words={five} />)
      expect(badges(container)).toHaveLength(0)
      advance(900)
      expect(badges(container)).toHaveLength(1)
      expect(badges(container)[0]).toHaveTextContent('43 fois')
      advance(3 * 550)
      const all = badges(container)
      expect(all).toHaveLength(4)
      expect(all.map((b) => b.textContent)).toEqual(['19 fois', '27 fois', '35 fois', '43 fois'])
    })

    it("annonce le top 4 aux lecteurs d'écran", () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} words={five} />)
      expect(screen.queryByRole('list', { name: 'Mots les plus proposés' })).toBeNull()
      rerender(<BigWordCloud {...base} revealed words={five} />)
      const list = screen.getByRole('list', { name: 'Mots les plus proposés' })
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(['1. a, 9 fois', '2. b, 7 fois', '3. c, 5 fois', '4. d, 3 fois'])
      advance(5000)
      for (const b of badges(container)) expect(b).toHaveAttribute('aria-hidden', 'true')
    })

    it("affiche tout d'un coup en reduced-motion", () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} reducedMotion words={five} />)
      advance(3000)
      rerender(<BigWordCloud {...base} reducedMotion revealed words={five} />)
      expect(badges(container)).toHaveLength(4)
    })

    it("affiche tout d'un coup après une reconnexion en révélation", () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} words={five} />)
      advance(300)
      rerender(<BigWordCloud {...base} revealed words={five} />)
      expect(badges(container)).toHaveLength(4)
    })

    it("affiche tout d'un coup quand le composant monte déjà révélé", () => {
      vi.useFakeTimers()
      const { container } = render(<BigWordCloud {...base} revealed words={five} />)
      expect(badges(container)).toHaveLength(4)
    })

    it("affiche tout d'un coup quand les mots et la révélation arrivent ensemble", () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} words={[]} />)
      advance(3000)
      rerender(<BigWordCloud {...base} revealed words={five} />)
      expect(badges(container)).toHaveLength(4)
    })

    it('remplace un mot du top 4 retiré par le suivant, sans déplacer les autres', () => {
      vi.useFakeTimers()
      const { container, rerender } = render(<BigWordCloud {...base} words={five} />)
      advance(2000)
      rerender(<BigWordCloud {...base} revealed words={five} />)
      advance(900 + 3 * 550)
      const before = ['b', 'c', 'd'].map((k) => wordEl(k).style.transform)
      const rest = five.slice(1)
      rerender(<BigWordCloud {...base} revealed words={rest} />)
      expect(wordEl('e')).toHaveAttribute('data-lit', 'true')
      expect(badges(container).map((b) => b.querySelector('.bigcloud__rank')?.textContent)).toEqual([
        '1',
        '2',
        '3',
        '4',
      ])
      expect(badges(container).map((b) => b.textContent)).toEqual(['17 fois', '25 fois', '33 fois', '41 fois'])
      expect(['b', 'c', 'd'].map((k) => wordEl(k).style.transform)).toEqual(before)
      expect(wordEl('a')).toHaveClass('is-leaving')
      advance(400)
      expect(screen.queryByText('a', { selector: '.bigcloud__text' })).toBeNull()
    })

    it("garde le libellé vide lisible par les lecteurs d'écran", () => {
      render(<BigWordCloud {...base} words={[]} />)
      expect(screen.getByText('En attente des premières idées…').closest('[aria-hidden="true"]')).toBeNull()
    })
  })
})
