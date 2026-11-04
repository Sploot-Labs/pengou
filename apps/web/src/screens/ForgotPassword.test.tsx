// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgotPassword } from './ForgotPassword'

const NEUTRE =
  'Si un compte existe pour cette adresse, un e-mail vient de partir. Pensez à vérifier les indésirables.'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status })
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  )
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("propose la correction du domaine à la perte de focus, et l'applique au clic", () => {
    renderScreen()
    const input = screen.getByLabelText('E-mail')
    typeEmail('camille@gmial.com')
    expect(screen.queryByText(/Vouliez-vous dire/)).not.toBeInTheDocument()
    fireEvent.blur(input)
    const suggestion = screen.getByRole('button', { name: 'camille@gmail.com' })
    expect(suggestion.closest('[aria-live="polite"]')).toHaveTextContent(
      'Vouliez-vous dire camille@gmail.com ?',
    )
    fireEvent.click(suggestion)
    expect(input).toHaveValue('camille@gmail.com')
    expect(screen.queryByText(/Vouliez-vous dire/)).not.toBeInTheDocument()
  })

  it.each([
    ['200', () => Promise.resolve(jsonResponse(200, { status: true }))],
    ['400', () => Promise.resolve(jsonResponse(400, { message: 'Inconnu' }))],
    ['500', () => Promise.resolve(jsonResponse(500))],
    ['une panne réseau', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])("affiche le message neutre quand l'API répond %s", async (_label, reply) => {
    fetchMock.mockImplementationOnce(reply)
    renderScreen()
    typeEmail('camille@gmail.com')
    submit()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(NEUTRE)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/request-password-reset')
    expect(JSON.parse(init.body)).toEqual({
      email: 'camille@gmail.com',
      redirectTo: '/reset-password',
    })
  })

  it('signale un excès de demandes sur 429', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { message: 'Too many requests' }))
    renderScreen()
    typeEmail('camille@gmail.com')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Trop de demandes, réessayez dans quelques minutes.',
    )
    expect(screen.queryByText(NEUTRE)).not.toBeInTheDocument()
  })

  it("refuse une adresse invalide sans appeler l'API", () => {
    renderScreen()
    typeEmail('pas-un-email')
    submit()
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
