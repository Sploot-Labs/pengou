import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendVerificationEmail, signUp } from './auth'

const fetchMock = vi.fn()

function lastBody() {
  return JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)
}

describe('auth e-mail', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('signUp envoie le callbackURL du retour de confirmation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u' } }), { status: 200 }))
    await signUp({ email: 'a@b.fr', password: 'motdepasse', name: 'A' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/sign-up/email')
    expect(lastBody()).toMatchObject({ email: 'a@b.fr', callbackURL: '/?email-verifie=1' })
  })

  it("sendVerificationEmail poste l'adresse et le callbackURL", async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await sendVerificationEmail('a@b.fr')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/send-verification-email')
    expect(lastBody()).toEqual({ email: 'a@b.fr', callbackURL: '/?email-verifie=1' })
  })

  it("sendVerificationEmail sans argument lit l'adresse de la session", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { email: 'moi@b.fr' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await sendVerificationEmail()
    expect(lastBody().email).toBe('moi@b.fr')
  })
})
