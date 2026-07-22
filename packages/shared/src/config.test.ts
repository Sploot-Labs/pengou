import { describe, it, expect } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('par défaut : single-tenant, Postgres local, scaling mémoire', () => {
    const cfg = loadConfig({})
    expect(cfg.tenancyMode).toBe('single')
    expect(cfg.databaseUrl).toBe('postgres://kahoot:kahoot@localhost:5432/kahoot')
    expect(cfg.scaling).toBe('memory')
    expect(cfg.port).toBe(3000)
  })

  it('passe en scaling redis quand REDIS_URL est défini', () => {
    const cfg = loadConfig({ REDIS_URL: 'redis://localhost:6379' })
    expect(cfg.scaling).toBe('redis')
    expect(cfg.redisUrl).toBe('redis://localhost:6379')
  })

  it('accepte le mode multi-tenant', () => {
    const cfg = loadConfig({ TENANCY_MODE: 'multi' })
    expect(cfg.tenancyMode).toBe('multi')
  })

  it('rejette une valeur TENANCY_MODE invalide', () => {
    expect(() => loadConfig({ TENANCY_MODE: 'nope' })).toThrow()
  })

  it('coerce PORT en nombre', () => {
    const cfg = loadConfig({ PORT: '8080' })
    expect(cfg.port).toBe(8080)
  })

  it('par défaut : aucun provider social complet, authUrl par défaut', () => {
    const cfg = loadConfig({})
    expect(cfg.authUrl).toBe('http://localhost:3000')
    expect(cfg.authSecret).toBeUndefined()
    expect(cfg.oauth.google.clientId).toBeUndefined()
    expect(cfg.oauth.google.clientSecret).toBeUndefined()
    expect(cfg.oauth.facebook.clientId).toBeUndefined()
    expect(cfg.oauth.github.clientId).toBeUndefined()
  })

  it('expose les identifiants Google quand GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont définis', () => {
    const cfg = loadConfig({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' })
    expect(cfg.oauth.google).toEqual({ clientId: 'gid', clientSecret: 'gsecret' })
  })
})
