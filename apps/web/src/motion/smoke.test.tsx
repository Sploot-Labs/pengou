// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('infra de test jsdom', () => {
  it('rend un composant React dans le DOM', () => {
    render(<p>bonjour</p>)
    expect(screen.getByText('bonjour')).toBeDefined()
  })
})
