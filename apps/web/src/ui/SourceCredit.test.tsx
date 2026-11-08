// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PodiumCredits, SourcesPanel } from './SourceCredit'

const a = { name: 'OpenQuizzDB, Jean Martin', license: 'CC BY-SA 4.0' }
const b = { name: 'Wikiquiz', license: 'CC0' }

afterEach(cleanup)

describe('SourcesPanel', () => {
  it('regroupe les questions par source en plages de numéros', () => {
    render(<SourcesPanel quizSource={null} questionSources={[a, a, a, null, b, a]} />)
    const panel = screen.getByRole('region', { name: 'Sources et licences' })
    expect(panel).toHaveTextContent('Questions 1 à 3 et 6 : OpenQuizzDB, Jean Martin.')
    expect(panel).toHaveTextContent('Question 5 : Wikiquiz.')
    expect(panel).toHaveTextContent(
      'Licences CC BY-SA 4.0 et CC0. Vos modifications de ces contenus restent sous cette licence. Crédits et licences',
    )
  })

  it("cite le quiz d'origine quand aucune question n'a de source", () => {
    render(<SourcesPanel quizSource={b} questionSources={[null]} />)
    const panel = screen.getByRole('region', { name: 'Sources et licences' })
    expect(panel).toHaveTextContent("Quiz d'origine : Wikiquiz.")
    expect(panel).not.toHaveTextContent('restent sous cette licence')
  })

  it('ne rend rien sans aucune source', () => {
    const { container } = render(<SourcesPanel quizSource={null} questionSources={[null, null]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PodiumCredits', () => {
  it("nomme les bases et la licence, et écrit l'adresse des crédits en clair", () => {
    const { container, rerender } = render(<PodiumCredits sources={[a, { ...a, name: 'OpenQuizzDB, Marie Durand' }]} />)
    expect(container).toHaveTextContent(
      `Questions issues d'OpenQuizzDB, licence CC BY-SA 4.0. Crédits : ${window.location.host}/credits`,
    )
    rerender(<PodiumCredits sources={[a, b]} />)
    expect(container).toHaveTextContent("Questions issues d'OpenQuizzDB et de Wikiquiz, licences CC BY-SA 4.0 et CC0.")
    rerender(<PodiumCredits sources={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
