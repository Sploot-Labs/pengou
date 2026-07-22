import { describe, it, expect } from 'vitest'
import { io as ioClient } from 'socket.io-client'
import { buildServer } from './app'
import { attachRealtime } from './realtime'
import { loadConfig } from '@splootlabs/shared'

describe('Socket.IO ping/pong', () => {
  it('répond pong à ping:test', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }))
    const io = attachRealtime(app)
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
