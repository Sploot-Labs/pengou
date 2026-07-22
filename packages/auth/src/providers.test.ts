import { describe, it, expect } from 'vitest'
import { enabledSocialProviders } from './providers.js'

describe('enabledSocialProviders', () => {
  it('vide par défaut', () => {
    expect(enabledSocialProviders({ oauth: {} } as never)).toEqual({})
  })
  it('active google quand les deux clés sont présentes', () => {
    const cfg = { oauth: { google: { clientId: 'gid', clientSecret: 'gsec' } } } as never
    expect(enabledSocialProviders(cfg)).toHaveProperty('google')
  })
  it('ignore un provider à clé partielle', () => {
    const cfg = { oauth: { github: { clientId: 'x', clientSecret: undefined } } } as never
    expect(enabledSocialProviders(cfg)).not.toHaveProperty('github')
  })
})
