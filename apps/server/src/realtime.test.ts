import { describe, it, expect } from 'vitest'
import { io as ioClient } from 'socket.io-client'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './app'
import { attachRealtime, allowedOrigins } from './realtime'
import { loadConfig } from '@splootlabs/shared'

async function listenOn(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('pas d\'adresse')
  return `http://127.0.0.1:${address.port}`
}

describe('Socket.IO ping/pong', () => {
  it('répond pong à ping:test', async () => {
    const config = loadConfig({ NODE_ENV: 'test' })
    const app = await buildServer(config)
    const io = attachRealtime(app, config)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('pas d\'adresse')

    const client = ioClient(`http://127.0.0.1:${address.port}`, {
      reconnection: false
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 3000)
        client.once('connect', () => {
          clearTimeout(timeout)
          resolve()
        })
        client.once('connect_error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })

      const reply = await new Promise<string>((resolve) => {
        client.emit('ping:test', (msg: string) => {
          resolve(msg)
        })
      })

      expect(reply).toBe('pong')
    } finally {
      client.disconnect()
      await io.close()
      await app.close()
    }
  }, 10000)
})

describe('Socket.IO CORS — origine restreinte à AppConfig.authUrl (hardening)', () => {
  it('allowedOrigins() : inclut authUrl, PAS de wildcard/reflet, + localhost dev hors production', () => {
    const dev = allowedOrigins({ authUrl: 'https://app.example.com', nodeEnv: 'development' })
    expect(dev).toContain('https://app.example.com')
    expect(dev).not.toContain('*')
    expect(dev.some((o) => o.includes('localhost'))).toBe(true)

    const prod = allowedOrigins({ authUrl: 'https://app.example.com', nodeEnv: 'production' })
    expect(prod).toEqual(['https://app.example.com']) // aucun repli localhost en production
  })

  // NB : un client Socket.IO Node (comme celui utilisé dans les autres tests de ce fichier)
  // n'applique PAS la same-origin policy — CORS est une restriction appliquée par le NAVIGATEUR
  // (il bloque la lecture de la réponse par le JS de la page, pas la requête elle-même), donc un
  // client Node se connecterait "avec succès" quelle que soit l'origine, même mal configurée.
  // La seule chose vérifiable côté serveur est l'en-tête `Access-Control-Allow-Origin` renvoyé
  // par la poignée de main HTTP (polling) sous-jacente : c'est CET en-tête qui, absent ou ne
  // correspondant pas à l'origine appelante, fait échouer la requête dans un VRAI navigateur.
  async function corsAllowOriginHeader(url: string, origin: string): Promise<string | null> {
    const res = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } })
    return res.headers.get('access-control-allow-origin')
  }

  it("une origine hors liste (ex. site tiers) ne reçoit PAS d'en-tête Access-Control-Allow-Origin (le navigateur bloquerait la lecture)", async () => {
    const config = loadConfig({ NODE_ENV: 'test', BETTER_AUTH_URL: 'http://localhost:3000' })
    const app = await buildServer(config)
    const io = attachRealtime(app, config)
    const url = await listenOn(app)

    try {
      const header = await corsAllowOriginHeader(url, 'https://evil.example.com')
      expect(header).not.toBe('https://evil.example.com')
      expect(header).toBeNull()
    } finally {
      await io.close()
      await app.close()
    }
  }, 10000)

  it("l'origine autorisée (AppConfig.authUrl) reçoit bien Access-Control-Allow-Origin la désignant", async () => {
    const config = loadConfig({ NODE_ENV: 'test', BETTER_AUTH_URL: 'http://localhost:3000' })
    const app = await buildServer(config)
    const io = attachRealtime(app, config)
    const url = await listenOn(app)

    try {
      const header = await corsAllowOriginHeader(url, config.authUrl)
      expect(header).toBe(config.authUrl)
    } finally {
      await io.close()
      await app.close()
    }
  }, 10000)
})
