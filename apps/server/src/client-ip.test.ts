import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientIpFromRequest, compileTrust, createForwardedForWarner, untrustedForwardingPeer } from './client-ip.js'
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
