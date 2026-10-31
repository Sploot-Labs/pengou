import { describe, it, expect } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('par défaut : single-tenant, Postgres local, scaling mémoire', () => {
    const cfg = loadConfig({})
    expect(cfg.tenancyMode).toBe('single')
    expect(cfg.databaseUrl).toBe('postgres://pengou:pengou@localhost:5432/pengou')
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

  it('lève une erreur claire en production sans BETTER_AUTH_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("n'exige pas BETTER_AUTH_SECRET en développement (fallback toléré)", () => {
    expect(() => loadConfig({})).not.toThrow()
    expect(loadConfig({}).authSecret).toBeUndefined()
  })

  it("n'exige pas BETTER_AUTH_SECRET en test (fallback toléré)", () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow()
  })

  it('accepte la production quand BETTER_AUTH_SECRET est fourni (32+ caractères)', () => {
    const secret = 'a'.repeat(32)
    const cfg = loadConfig({ NODE_ENV: 'production', BETTER_AUTH_SECRET: secret })
    expect(cfg.authSecret).toBe(secret)
  })
})

describe('loadConfig — inactivité/balayage', () => {
  it('défauts : 30 min d\'inactivité, 5 min de balayage (en ms)', () => {
    const c = loadConfig({ NODE_ENV: 'test' })
    expect(c.sessionInactivityTimeoutMs).toBe(30 * 60_000)
    expect(c.sessionSweepIntervalMs).toBe(5 * 60_000)
  })

  it('surcharge via env (minutes → ms)', () => {
    const c = loadConfig({ NODE_ENV: 'test', SESSION_INACTIVITY_TIMEOUT_MINUTES: '10', SESSION_SWEEP_INTERVAL_MINUTES: '1' })
    expect(c.sessionInactivityTimeoutMs).toBe(10 * 60_000)
    expect(c.sessionSweepIntervalMs).toBe(1 * 60_000)
  })
})

describe('loadConfig, plafond de joueurs par partie', () => {
  it('MAX_PLAYERS_PER_SESSION vaut 640 par défaut', () => {
    expect(loadConfig({}).maxPlayersPerSession).toBe(640)
  })

  it('MAX_PLAYERS_PER_SESSION est coercé en nombre', () => {
    expect(loadConfig({ MAX_PLAYERS_PER_SESSION: '1200' }).maxPlayersPerSession).toBe(1200)
  })

  it('MAX_PLAYERS_PER_SESSION refuse 0, un négatif et un décimal', () => {
    for (const v of ['0', '-5', '2.5']) expect(() => loadConfig({ MAX_PLAYERS_PER_SESSION: v })).toThrow()
  })
})
