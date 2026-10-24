// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  // MemoryRouter : le logo est désormais un <Link to="/"> (retour à l'accueil),
  // qui exige un contexte routeur.
  it('rend le logo (lien vers l’accueil), la brandline et les actions', () => {
    render(
      <MemoryRouter>
        <AppHeader brandline="quiz en direct" actions={<button>Se déconnecter</button>} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Pengou')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /retour à l.accueil/i })).toHaveAttribute('href', '/')
    expect(screen.getByText(/quiz en direct/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
  })
})
