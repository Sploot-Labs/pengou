import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8')

// Le site pengou.fr présente Pengou dans les moteurs ; l'application ne doit pas lui faire
// concurrence sur sa propre marque (titre distinct, noindex) et vouvoie ses visiteurs.
describe('index.html', () => {
  it("annonce l'application, pas le site vitrine", () => {
    expect(html).toContain("<title>Pengou, l'application : rejoindre ou animer une partie</title>")
  })

  it('demande le noindex en filet de sécurité, sans canonical', () => {
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).not.toContain('rel="canonical"')
  })

  it('déclare og:url et og:image, rendues absolues par le serveur', () => {
    expect(html).toContain('<meta property="og:url" content="/" />')
    expect(html).toContain('<meta property="og:image" content="/og-image.png" />')
  })

  it('prépare un aperçu de lien complet (nom du site, langue, grande image aux bonnes dimensions)', () => {
    expect(html).toContain('<meta property="og:site_name" content="Pengou" />')
    expect(html).toContain('<meta property="og:locale" content="fr_FR" />')
    expect(html).toContain('<meta property="og:image:width" content="1200" />')
    expect(html).toContain('<meta property="og:image:height" content="630" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })

  it('vouvoie dans la description', () => {
    const description = html.match(/name="description"\s+content="([^"]*)"/)?.[1] ?? ''
    expect(description).toMatch(/Rejoignez/)
    expect(description).not.toMatch(/\b(Crée|tu|ton|ta|tes)\b/)
  })
})
