import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app'
import { sanitizeLogUrl } from './request-log'

const TOKEN = 'AbCdEf0123456789xyzQRStuvW'

/** Flux pino capturé en mémoire : une entrée par ligne JSON. */
function captureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(...String(chunk).split('\n').filter(Boolean))
      done()
    },
  })
  return { stream, lines }
}

describe('journal des requêtes sans token', () => {
  it("n'écrit ni le token de réinitialisation ni la query string", async () => {
    const { stream, lines } = captureStream()
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }), { logStream: stream })
    app.get('/api/auth/reset-password/:token', async () => ({ ok: true }))
    app.get('/boom/:token', async () => { throw new Error('échec') })
    await app.inject({ method: 'GET', url: `/api/auth/reset-password/${TOKEN}?callbackURL=/x` })
    await app.inject({ method: 'GET', url: `/reset-password?token=${TOKEN}` })
    await app.inject({ method: 'GET', url: `/api/auth/verify-email?token=${TOKEN}&callbackURL=%2F` })
    await app.inject({ method: 'GET', url: `/boom/${TOKEN}` })
    await app.close()

    expect(lines.length).toBeGreaterThan(0)
    const urls = lines.map((l) => JSON.parse(l)).filter((e) => e.req?.url).map((e) => e.req.url)
    expect(urls).toContain('/api/auth/reset-password/AbCdEf…')
    expect(urls).toContain('/reset-password')
    expect(urls).toContain('/api/auth/verify-email')
    for (const line of lines) {
      expect(line).not.toContain(TOKEN)
      expect(line).not.toContain('callbackURL')
    }
  })
})

describe('sanitizeLogUrl', () => {
  it('retire la query et masque les segments à allure de jeton', () => {
    expect(sanitizeLogUrl(`/api/invitations/${TOKEN}/accept?v=abc`)).toBe('/api/invitations/AbCdEf…/accept')
  })

  it('garde les segments de route en kebab-case et les UUID', () => {
    expect(sanitizeLogUrl('/api/auth/send-verification-email')).toBe('/api/auth/send-verification-email')
    const id = '0b9d6c1e-3f2a-4c5b-8d7e-1a2b3c4d5e6f'
    expect(sanitizeLogUrl(`/api/quizzes/${id}`)).toBe(`/api/quizzes/${id}`)
  })

  it('supporte une URL absente', () => {
    expect(sanitizeLogUrl(undefined)).toBe('')
  })
})
