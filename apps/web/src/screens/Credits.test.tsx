// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Credits } from './Credits'

describe('Credits', () => {
  afterEach(cleanup)

  it('a une section par ancre visée par les mentions de la bibliothèque', () => {
    render(
      <MemoryRouter>
        <Credits />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Crédits et licences' })).toBeInTheDocument()
    for (const [id, name] of [
      ['openquizzdb', 'OpenQuizzDB'],
      ['opentdb', 'Open Trivia Database'],
      ['traductions', 'Traductions'],
      ['licence', 'Licence'],
    ]) {
      expect(screen.getByRole('region', { name })).toHaveAttribute('id', id)
    }
    expect(screen.getByRole('link', { name: "fichier de licence d'OpenQuizzDB" })).toHaveAttribute(
      'href',
      'https://github.com/Sploot-Labs/pengou/blob/main/packages/library/catalog/openquizzdb/LICENSE.md',
    )
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/deed.fr',
    )
  })
})
