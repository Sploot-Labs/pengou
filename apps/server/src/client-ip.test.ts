import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientIpFromRequest, compileTrust } from './client-ip.js'

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
