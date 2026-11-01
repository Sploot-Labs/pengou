import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientIpFromRequest, compileTrust, createForwardedForWarner, pinFailureKey, untrustedForwardingPeer } from './client-ip.js'
import { buildServer } from './app.js'
import { loadConfig } from '@splootlabs/shared'

function fakeRequest(remoteAddress: string, xff?: string): IncomingMessage {
  const headers: Record<string, string> = {}
  if (xff !== undefined) headers['x-forwarded-for'] = xff
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage
}

describe('clientIpFromRequest', () => {
  it('sans proxy de confiance, ignore X-Forwarded-For', () => {
    const req = fakeRequest('203.0.113.9', '192.0.2.1')
    expect(clientIpFromRequest(req, compileTrust([]))).toBe('203.0.113.9')
  })

  it('derrière un proxy de confiance, prend le dernier saut non fiable', () => {
    const req = fakeRequest('10.0.0.2', '192.0.2.1, 198.51.100.7')
    expect(clientIpFromRequest(req, compileTrust(['10.0.0.0/8']))).toBe('198.51.100.7')
  })

  it("un pair hors de la liste de confiance n'est pas cru, même s'il envoie X-Forwarded-For", () => {
    const req = fakeRequest('203.0.113.9', '192.0.2.1')
    expect(clientIpFromRequest(req, compileTrust(['10.0.0.0/8']))).toBe('203.0.113.9')
  })

  it('accepte les mots-clés de proxy-addr (loopback)', () => {
    const req = fakeRequest('127.0.0.1', '198.51.100.7')
    expect(clientIpFromRequest(req, compileTrust(['loopback']))).toBe('198.51.100.7')
  })
})

describe('untrustedForwardingPeer', () => {
  it("signale un pair loopback ou privé non approuvé qui envoie X-Forwarded-For", () => {
    expect(untrustedForwardingPeer(fakeRequest('127.0.0.1', '198.51.100.7'), compileTrust([]))).toBe('127.0.0.1')
    expect(untrustedForwardingPeer(fakeRequest('172.18.0.1', '198.51.100.7'), compileTrust(['127.0.0.1']))).toBe('172.18.0.1')
    expect(untrustedForwardingPeer(fakeRequest('::ffff:10.0.0.2', '198.51.100.7'), compileTrust([]))).toBe('::ffff:10.0.0.2')
  })

  it('ne signale rien sans X-Forwarded-For, pour un pair approuvé ou pour un pair public', () => {
    expect(untrustedForwardingPeer(fakeRequest('127.0.0.1'), compileTrust([]))).toBeUndefined()
    expect(untrustedForwardingPeer(fakeRequest('172.18.0.1', '198.51.100.7'), compileTrust(['172.16.0.0/12']))).toBeUndefined()
    expect(untrustedForwardingPeer(fakeRequest('203.0.113.9', '198.51.100.7'), compileTrust([]))).toBeUndefined()
  })
})

describe('avertissement X-Forwarded-For non approuvé', () => {
  it("createForwardedForWarner n'avertit qu'une fois, avec le message attendu", () => {
    const warn = vi.fn()
    const check = createForwardedForWarner(compileTrust([]), warn)
    check(fakeRequest('203.0.113.9', '198.51.100.7'))
    expect(warn).not.toHaveBeenCalled()
    check(fakeRequest('172.18.0.1', '198.51.100.7'))
    check(fakeRequest('172.18.0.2', '198.51.100.7'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      "X-Forwarded-For reçu d'un pair non approuvé (172.18.0.1) : vérifiez TRUSTED_PROXIES, sinon tous les clients partagent la même IP pour les limites de débit.",
    )
  })

  it("le serveur HTTP ne journalise qu'un avertissement pour plusieurs requêtes", async () => {
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    const warn = vi.spyOn(app.log, 'warn')
    for (let i = 0; i < 3; i++) {
      // inject : pair 127.0.0.1, absent de TRUSTED_PROXIES (vide).
      const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '198.51.100.7' } })
      expect(res.statusCode).toBe(200)
    }
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("X-Forwarded-For reçu d'un pair non approuvé (127.0.0.1)")
    await app.close()
  })
})

describe('pinFailureKey', () => {
  it('garde une IPv4 telle quelle', () => {
    expect(pinFailureKey('203.0.113.9')).toBe('203.0.113.9')
  })

  it('normalise une IPv4 mappée en IPv6 vers son IPv4', () => {
    expect(pinFailureKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(pinFailureKey('::FFFF:203.0.113.9')).toBe('203.0.113.9')
    expect(pinFailureKey('0:0:0:0:0:ffff:cb00:7109')).toBe('203.0.113.9')
  })

  it('agrège deux IPv6 du même /64 sous la même clé', () => {
    const a = pinFailureKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    const b = pinFailureKey('2001:0db8:0001:0002::1')
    expect(a).toBe(b)
    expect(a).toBe('2001:db8:1:2::/64')
  })

  it('sépare deux IPv6 de /64 différents', () => {
    expect(pinFailureKey('2001:db8:1:2::1')).not.toBe(pinFailureKey('2001:db8:1:3::1'))
  })

  it('agrège aussi les adresses à zone (fe80::1%eth0) et compressées en tête', () => {
    expect(pinFailureKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(pinFailureKey('::1')).toBe('0:0:0:0::/64')
  })
})
