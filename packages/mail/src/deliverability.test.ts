import { describe, expect, it, vi } from 'vitest'
import { checkEmailDeliverable, type DnsResolver } from './deliverability.js'

function dnsError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function resolver(over: Partial<DnsResolver> = {}): DnsResolver {
  return {
    resolveMx: async () => [{ exchange: 'mx.example.org', priority: 10 }],
    resolve4: async () => {
      throw dnsError('ENODATA')
    },
    resolve6: async () => {
      throw dnsError('ENODATA')
    },
    ...over,
  }
}

const notFound = async (): Promise<never> => {
  throw dnsError('ENOTFOUND')
}

describe('checkEmailDeliverable', () => {
  it('refuse un domaine jetable et ses sous-domaines, même sans DNS', async () => {
    expect(await checkEmailDeliverable('x@yopmail.com', { dns: false })).toBe('disposable')
    expect(await checkEmailDeliverable('x@sub.yopmail.com', { dns: false })).toBe('disposable')
  })

  it('accepte quand un MX existe', async () => {
    expect(await checkEmailDeliverable('a@example.org', { dns: true, resolver: resolver() })).toBe('ok')
  })

  it('accepte sans MX quand un enregistrement A existe', async () => {
    const r = resolver({
      resolveMx: async () => [],
      resolve4: async () => ['192.0.2.1'],
    })
    expect(await checkEmailDeliverable('a@example.org', { dns: true, resolver: r })).toBe('ok')
  })

  it('refuse quand les trois réponses sont négatives', async () => {
    const r = { resolveMx: notFound, resolve4: notFound, resolve6: notFound }
    expect(await checkEmailDeliverable('a@example.org', { dns: true, resolver: r })).toBe('undeliverable')
  })

  it('refuse un MX nul', async () => {
    for (const exchange of ['', '.']) {
      const r = resolver({ resolveMx: async () => [{ exchange, priority: 0 }] })
      expect(await checkEmailDeliverable('a@example.org', { dns: true, resolver: r })).toBe('undeliverable')
    }
  })

  it('laisse passer sur ETIMEOUT avec un avertissement sans partie locale', async () => {
    const warn = vi.fn()
    const logger = { info: vi.fn(), warn, error: vi.fn() }
    const r = resolver({
      resolveMx: async () => {
        throw dnsError('ETIMEOUT')
      },
    })
    expect(
      await checkEmailDeliverable('camille.secret@example.org', { dns: true, resolver: r, logger }),
    ).toBe('ok')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('camille')
  })

  it('laisse passer quand le résolveur ne répond jamais, après timeoutMs', async () => {
    const never = () => new Promise<never>(() => {})
    const r = { resolveMx: never, resolve4: never, resolve6: never }
    expect(
      await checkEmailDeliverable('a@example.org', { dns: true, resolver: r, timeoutMs: 10 }),
    ).toBe('ok')
  })

  it('normalise la casse et les espaces avant la recherche', async () => {
    const resolveMx = vi.fn(async () => [{ exchange: 'mx.gmail.com', priority: 5 }])
    const r = resolver({ resolveMx })
    expect(
      await checkEmailDeliverable('  Camille+pengou@Gmail.COM ', { dns: true, resolver: r }),
    ).toBe('ok')
    expect(resolveMx).toHaveBeenCalledWith('gmail.com')
  })
})
