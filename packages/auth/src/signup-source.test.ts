import { describe, expect, it } from 'vitest'
import { applySignupSource } from './signup-source'

const user = { name: 'Hôte', email: 'hote@example.org' }

describe('applySignupSource', () => {
  it("enregistre la provenance normalisée d'une inscription e-mail", () => {
    const data = applySignupSource(user, { path: '/sign-up/email', body: { from: 'Kahoot-Gratuit' } })
    expect(data).toEqual({ ...user, signupSource: 'kahoot-gratuit' })
  })

  it('ignore une provenance invalide sans refuser', () => {
    expect(applySignupSource(user, { path: '/sign-up/email', body: { from: '<script>' } }).signupSource).toBeNull()
  })

  it('laisse null sans provenance, hors inscription e-mail ou sans contexte', () => {
    expect(applySignupSource(user, { path: '/sign-up/email', body: {} }).signupSource).toBeNull()
    expect(applySignupSource(user, { path: '/callback/github', body: { from: 'accueil' } }).signupSource).toBeNull()
    expect(applySignupSource(user, null).signupSource).toBeNull()
  })
})
