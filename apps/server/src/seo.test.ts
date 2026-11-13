import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@splootlabs/shared'
import { buildServer } from './app'
import { registerStatic, renderIndexHtml } from './static'

let dist: string

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'web-dist-seo-'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>')
  writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n')
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("spa")')
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
})

async function serve(env: Record<string, string> = {}) {
  const app = await buildServer(loadConfig({ NODE_ENV: 'test', ...env }))
  app.get('/api/ping', async () => ({ ok: true }))
  registerStatic(app, dist)
  return app
}

describe('en-tête X-Robots-Tag', () => {
  it("est envoyé par défaut sur le HTML, les fichiers, l'API, /health et les 404", async () => {
    const app = await serve()
    const urls = ['/', '/join', '/assets/index-abc123.js', '/robots.txt', '/api/ping', '/health']
    for (const url of [...urls, '/api/x', '/zzz-unknown', '/sitemap.xml', '/.well-known/security.txt']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.headers['x-robots-tag'], url).toBe('noindex')
    }
    await app.close()
  })

  it("n'est pas envoyé avec ROBOTS_NOINDEX=false", async () => {
    const app = await serve({ ROBOTS_NOINDEX: 'false' })
    for (const url of ['/', '/assets/index-abc123.js', '/api/ping']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.headers['x-robots-tag'], url).toBeUndefined()
    }
    await app.close()
  })
})

describe('robots.txt', () => {
  it("est servi en text/plain et autorise l'exploration", async () => {
    const app = await serve()
    const res = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/plain/)
    expect(res.body).toContain('Allow: /')
    expect(res.body).not.toMatch(/Disallow/)
    await app.close()
  })
})

const PAGE = `<!doctype html>
<html lang="fr">
  <head>
    <title>Pengou</title>
    <meta name="robots" content="noindex" />

    <meta property="og:url" content="/" />
    <meta property="og:image" content="/og-image.png" />
  </head>
  <body><div id="root"></div></body>
</html>`

describe('renderIndexHtml', () => {
  it("rend og:url et og:image absolues sur l'origine de l'instance", () => {
    const html = renderIndexHtml(PAGE, { publicUrl: 'https://app.pengou.fr/chemin-ignore' })
    expect(html).toContain('<meta property="og:url" content="https://app.pengou.fr/" />')
    expect(html).toContain('<meta property="og:image" content="https://app.pengou.fr/og-image.png" />')
  })

  it("garde la balise robots par défaut et la retire si l'indexation est autorisée", () => {
    expect(renderIndexHtml(PAGE, {})).toContain('<meta name="robots" content="noindex" />')
    const indexable = renderIndexHtml(PAGE, { noindex: false })
    expect(indexable).not.toContain('robots')
    expect(indexable).toContain('<title>Pengou</title>')
  })
})

describe('page servie', () => {
  it('porte les métadonnées rendues, sur la racine, une route et /index.html', async () => {
    const pageDist = mkdtempSync(join(tmpdir(), 'web-dist-page-'))
    writeFileSync(join(pageDist, 'index.html'), PAGE)
    const app = await buildServer(loadConfig({ NODE_ENV: 'test' }))
    registerStatic(app, pageDist, { publicUrl: 'https://quiz.example.org', noindex: true })
    for (const url of ['/', '/join', '/index.html']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(200)
      expect(res.body, url).toContain('content="https://quiz.example.org/og-image.png"')
      expect(res.body, url).toContain('<meta name="robots" content="noindex" />')
    }
    await app.close()
    rmSync(pageDist, { recursive: true, force: true })
  })
})
