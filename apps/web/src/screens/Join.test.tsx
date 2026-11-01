// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Join } from './Join'

const mockEmitAck = vi.fn()

vi.mock('../realtime/useGameSocket', () => ({
  useGameSocket: () => ({
    socket: { connected: true },
    connected: true,
    emitAck: mockEmitAck,
    on: () => () => {},
  }),
}))

function submitForm() {
  render(
    <MemoryRouter initialEntries={['/join']}>
      <Join />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Code banquise'), { target: { value: '123456' } })
  fireEvent.change(screen.getByLabelText('Ton pseudo'), { target: { value: 'Plume' } })
  fireEvent.click(screen.getByRole('button', { name: 'Rejoindre la colonie' }))
}

describe('Join : erreurs renvoyées par le serveur', () => {
  beforeEach(() => {
    mockEmitAck.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('partie pleine : affiche « La partie est complète. » sans invalider le PIN', async () => {
    mockEmitAck.mockRejectedValueOnce(new Error('La partie est complète.'))
    submitForm()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('La partie est complète.')
    expect(screen.getByLabelText('Code banquise')).not.toHaveAttribute('aria-invalid')
    expect(alert).toHaveFocus()
  })

  it('PIN invalide : le message reste attaché au champ PIN', async () => {
    mockEmitAck.mockRejectedValueOnce(new Error('PIN invalide'))
    submitForm()
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN invalide')
    expect(screen.getByLabelText('Code banquise')).toHaveAttribute('aria-invalid', 'true')
  })
})
