import { describe, it, expect } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('par défaut : single-tenant, SQLite fichier, scaling mémoire', () => {
    const cfg = loadConfig({})
    expect(cfg.tenancyMode).toBe('single')
    expect(cfg.databaseUrl).toBe('file:./data/app.db')
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
})
