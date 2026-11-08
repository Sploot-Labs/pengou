import { describe, it, expect } from 'vitest'
import { loadConfig, DEFAULT_APP_DB_PASSWORD } from './config'

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
    const cfg = loadConfig({ NODE_ENV: 'production', BETTER_AUTH_SECRET: secret, APP_DB_PASSWORD: 'autre' })
    expect(cfg.authSecret).toBe(secret)
  })
})

describe('loadConfig — inactivité/balayage', () => {
  it("défauts : 30 min d'inactivité, 5 min de balayage (en ms)", () => {
    const c = loadConfig({ NODE_ENV: 'test' })
    expect(c.sessionInactivityTimeoutMs).toBe(30 * 60_000)
    expect(c.sessionSweepIntervalMs).toBe(5 * 60_000)
  })

  it('surcharge via env (minutes → ms)', () => {
    const c = loadConfig({
      NODE_ENV: 'test',
      SESSION_INACTIVITY_TIMEOUT_MINUTES: '10',
      SESSION_SWEEP_INTERVAL_MINUTES: '1',
    })
    expect(c.sessionInactivityTimeoutMs).toBe(10 * 60_000)
    expect(c.sessionSweepIntervalMs).toBe(1 * 60_000)
  })
})

describe("loadConfig, mot de passe d'app_role en production", () => {
  const prod = { NODE_ENV: 'production', BETTER_AUTH_SECRET: 'a'.repeat(32) }

  it('refuse la production sans APP_DB_PASSWORD', () => {
    expect(() => loadConfig(prod)).toThrow(/APP_DB_PASSWORD doit être défini en production/)
  })

  it('refuse la production avec le mot de passe par défaut', () => {
    expect(() => loadConfig({ ...prod, APP_DB_PASSWORD: DEFAULT_APP_DB_PASSWORD })).toThrow(/APP_DB_PASSWORD/)
  })

  it('accepte la production avec un mot de passe personnalisé', () => {
    expect(loadConfig({ ...prod, APP_DB_PASSWORD: 'autre' }).appDbPassword).toBe('autre')
  })

  it('accepte la production quand APP_DATABASE_URL est fourni', () => {
    expect(() => loadConfig({ ...prod, APP_DATABASE_URL: 'postgres://app_role:x@db:5432/pengou' })).not.toThrow()
  })

  it('ne dit rien en développement sans APP_DB_PASSWORD', () => {
    expect(loadConfig({}).appDbPassword).toBe(DEFAULT_APP_DB_PASSWORD)
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

describe("loadConfig, budget d'échecs de PIN", () => {
  it('PIN_FAILURE_MAX vaut 100 par défaut', () => {
    expect(loadConfig({}).pinFailureMax).toBe(100)
  })

  it('PIN_FAILURE_MAX est lu et coercé en nombre', () => {
    expect(loadConfig({ PIN_FAILURE_MAX: '250' }).pinFailureMax).toBe(250)
  })

  it('PIN_FAILURE_MAX refuse 0, un négatif et un décimal', () => {
    for (const v of ['0', '-5', '2.5']) expect(() => loadConfig({ PIN_FAILURE_MAX: v })).toThrow()
  })
})

describe('messagerie', () => {
  it('sans MAIL_TRANSPORT : transport none et contrôle de domaine désactivé', () => {
    const c = loadConfig({})
    expect(c.mail.transport).toBe('none')
    expect(c.emailDomainCheck).toBe(false)
  })
  it('smtp : port 587 par défaut', () => {
    const c = loadConfig({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'mailpit', MAIL_FROM: 'Pengou <a@b.fr>' })
    expect(c.mail.transport).toBe('smtp')
    if (c.mail.transport === 'smtp') expect(c.mail.smtp.port).toBe(587)
  })
  it('smtp : SMTP_REQUIRE_TLS vaut true par défaut, false si demandé, vide = défaut', () => {
    const e = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'h', MAIL_FROM: 'a@b.fr' }
    const tls = (extra: Record<string, string>) => {
      const c = loadConfig({ ...e, ...extra })
      return c.mail.transport === 'smtp' ? c.mail.smtp.requireTls : undefined
    }
    expect(tls({})).toBe(true)
    expect(tls({ SMTP_REQUIRE_TLS: 'false' })).toBe(false)
    expect(tls({ SMTP_REQUIRE_TLS: '' })).toBe(true)
  })
  it('smtp sans SMTP_HOST : erreur', () => {
    expect(() => loadConfig({ MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'a@b.fr' })).toThrow(/SMTP_HOST/)
  })
  it('brevo sans BREVO_API_KEY : erreur', () => {
    expect(() => loadConfig({ MAIL_TRANSPORT: 'brevo', MAIL_FROM: 'a@b.fr' })).toThrow(/BREVO_API_KEY/)
  })
  it('transport choisi sans MAIL_FROM : erreur', () => {
    expect(() => loadConfig({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'h' })).toThrow(/MAIL_FROM/)
  })
  it('SMTP_USER sans SMTP_PASSWORD et inversement : erreur', () => {
    const base = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'h', MAIL_FROM: 'a@b.fr' }
    expect(() => loadConfig({ ...base, SMTP_USER: 'u' })).toThrow(/SMTP_PASSWORD/)
    expect(() => loadConfig({ ...base, SMTP_PASSWORD: 'p' })).toThrow(/SMTP_USER/)
  })
  it('EMAIL_DOMAIN_CHECK : auto suit le transport, false et true forcent', () => {
    const brevo = { MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.fr' }
    expect(loadConfig({ ...brevo }).emailDomainCheck).toBe(true)
    expect(loadConfig({ ...brevo, EMAIL_DOMAIN_CHECK: 'false' }).emailDomainCheck).toBe(false)
    expect(loadConfig({ EMAIL_DOMAIN_CHECK: 'true' }).emailDomainCheck).toBe(true)
  })
  it("les erreurs ne contiennent jamais la valeur d'un secret", () => {
    let message = ''
    try {
      loadConfig({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'h',
        MAIL_FROM: 'a@b.fr',
        SMTP_PASSWORD: 's3cr3t-valeur',
      })
    } catch (e) {
      message = String(e)
    }
    expect(message).not.toBe('')
    expect(message).not.toContain('s3cr3t-valeur')
    message = ''
    try {
      loadConfig({ MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 's3cr3t-valeur' })
    } catch (e) {
      message = String(e)
    }
    expect(message).not.toBe('')
    expect(message).not.toContain('s3cr3t-valeur')
  })
  it('variables vides traitées comme absentes', () => {
    expect(loadConfig({ MAIL_TRANSPORT: '' }).mail.transport).toBe('none')
    const c = loadConfig({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'h',
      MAIL_FROM: 'a@b.fr',
      SMTP_USER: '',
      SMTP_PASSWORD: ' ',
      SMTP_PORT: '',
    })
    if (c.mail.transport === 'smtp') {
      expect(c.mail.smtp.user).toBeUndefined()
      expect(c.mail.smtp.password).toBeUndefined()
      expect(c.mail.smtp.port).toBe(587)
    }
    expect(() => loadConfig({ MAIL_TRANSPORT: 'brevo', MAIL_FROM: 'a@b.fr', BREVO_API_KEY: '' })).toThrow(
      /BREVO_API_KEY/,
    )
  })
  it('production sans transport : ne lève pas', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_DB_PASSWORD: 'custom' }),
    ).not.toThrow()
  })
})

describe("loadConfig, conditions d'utilisation (CGU)", () => {
  const LEGAL = {
    LEGAL_TERMS_URL: 'https://pengou.fr/cgu/',
    LEGAL_PRIVACY_URL: 'https://pengou.fr/politique-de-confidentialite/',
    LEGAL_TERMS_VERSION: '2026-10-31',
  }

  it('sans LEGAL_TERMS_VERSION, la fonction est désactivée', () => {
    expect(loadConfig({}).legal).toBeNull()
  })

  it("une valeur vide (relais compose d'une variable non définie) équivaut à une variable absente", () => {
    expect(loadConfig({ LEGAL_TERMS_URL: '', LEGAL_PRIVACY_URL: '', LEGAL_TERMS_VERSION: '' }).legal).toBeNull()
  })

  it('expose la version et les deux liens quand tout est défini', () => {
    expect(loadConfig(LEGAL).legal).toEqual({
      termsVersion: '2026-10-31',
      termsUrl: 'https://pengou.fr/cgu/',
      privacyUrl: 'https://pengou.fr/politique-de-confidentialite/',
    })
  })

  it("refuse une version qui n'est pas une date AAAA-MM-JJ valide", () => {
    for (const v of ['v2', '2026-13-01', '2026-02-30', '31/10/2026']) {
      expect(() => loadConfig({ ...LEGAL, LEGAL_TERMS_VERSION: v })).toThrow(/LEGAL_TERMS_VERSION/)
    }
  })

  it('exige les deux liens quand la version est définie', () => {
    expect(() => loadConfig({ ...LEGAL, LEGAL_TERMS_URL: '' })).toThrow(/LEGAL_TERMS_URL/)
    expect(() => loadConfig({ ...LEGAL, LEGAL_PRIVACY_URL: undefined })).toThrow(/LEGAL_PRIVACY_URL/)
  })

  it("refuse un lien qui n'est pas une URL http(s)", () => {
    expect(() => loadConfig({ ...LEGAL, LEGAL_TERMS_URL: 'javascript:alert(1)' })).toThrow()
  })
})
