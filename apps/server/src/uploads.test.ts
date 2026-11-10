import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app'
import { registerUploads } from './uploads'

let base: string
let mediaDir: string
let app: FastifyInstance

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'uploads-'))
  mediaDir = join(base, 'media')
  mkdirSync(join(mediaDir, 't1'), { recursive: true })
  writeFileSync(
    join(mediaDir, 't1', 'abc.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  )
  writeFileSync(join(mediaDir, 't1', '.secret.png'), 'x')
  writeFileSync(join(base, 'secret.txt'), 'TOP-SECRET')
  app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
  registerUploads(app, mediaDir)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  rmSync(base, { recursive: true, force: true })
})

describe('service des images envoyées', () => {
  it('sert un fichier envoyé avec cache long et nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/t1/abc.png' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('404 sur un fichier absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/t1/absent.png' })
    expect(res.statusCode).toBe(404)
  })

  it('refuse la traversée de répertoire', async () => {
    for (const url of [
      '/uploads/..%2fsecret.txt',
      '/uploads/..%2f..%2fpackage.json',
      '/uploads/t1/..%2f..%2fsecret.txt',
      '/uploads/../secret.txt',
      '/uploads/%2e%2e/secret.txt',
    ]) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).not.toBe(200)
      expect(res.body, url).not.toContain('TOP-SECRET')
    }
  })

  it('refuse les fichiers cachés', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/t1/.secret.png' })
    expect([403, 404]).toContain(res.statusCode)
  })

  it('pas de listing de dossier', async () => {
    for (const url of ['/uploads/t1/', '/uploads/t1', '/uploads/']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(404)
      expect(res.body, url).not.toContain('abc.png')
    }
  })

  it('refuse toute écriture', async () => {
    const res = await app.inject({ method: 'PUT', url: '/uploads/t1/new.png', payload: 'x' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(existsSync(join(mediaDir, 't1', 'new.png'))).toBe(false)
  })

  it("crée le dossier média s'il manque", async () => {
    const missing = join(base, 'a', 'b')
    const other = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    registerUploads(other, missing)
    await other.ready()
    expect(existsSync(missing)).toBe(true)
    await other.close()
  })
})
