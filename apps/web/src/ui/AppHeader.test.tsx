// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  it('rend le logo, la brandline et les actions', () => {
    render(<AppHeader brandline="quiz en direct" actions={<button>Se déconnecter</button>} />)
    expect(screen.getByText('Arena')).toBeInTheDocument()
    expect(screen.getByText(/quiz en direct/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
  })
})
