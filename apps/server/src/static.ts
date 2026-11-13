import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { isSpaRoute } from '@splootlabs/shared'

export type StaticOptions = {
  /** URL publique de l'instance (BETTER_AUTH_URL) : rend og:url et og:image absolues. */
  publicUrl?: string
  /** Garde la balise robots noindex de index.html (défaut vrai) ; faux la retire. */
  noindex?: boolean
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

const ROBOTS_META = /[ \t]*<meta\s+name="robots"\s+content="noindex"\s*\/?>[ \t]*\r?\n?/
const RELATIVE_OG = /(<meta\s+property="og:(?:url|image)"\s+content=")(\/[^"]*)"/g

/**
 * Adapte index.html à l'instance : les réseaux sociaux exigent des URL absolues pour og:url et
 * og:image, et une instance auto-hébergée doit pointer vers elle-même, pas vers app.pengou.fr.
 */
export function renderIndexHtml(html: string, { publicUrl, noindex = true }: StaticOptions): string {
  let out = html
  if (publicUrl) {
    const origin = new URL(publicUrl).origin
    out = out.replace(RELATIVE_OG, (_match, start: string, path: string) => `${start}${origin}${path}"`)
  }
  if (!noindex) out = out.replace(ROBOTS_META, '')
  return out
}

/**
 * Vrai si l'en-tête If-None-Match désigne cet ETag. Comparaison faible, comme le veut la norme pour
 * une requête GET : un reverse proxy qui compresse la réponse renvoie l'ETag sous sa forme `W/"…"`.
 */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').some((candidate) => {
    const value = candidate.trim()
    return value === '*' || value === etag || value === `W/${etag}`
  })
}

/** Dernier segment avec une extension (`/sitemap.xml`, `/assets/x.js`) : une demande de fichier. */
function looksLikeFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return last.includes('.')
}

export function registerStatic(app: FastifyInstance, webDistDir: string, options: StaticOptions = {}): void {
  // Lue au premier besoin puis gardée en mémoire : le build ne change pas pendant la vie du
  // process, et un serveur de dev lancé sans build du SPA démarre quand même.
  let index: { html: string; etag: string } | undefined
  async function sendIndex(request: FastifyRequest, reply: FastifyReply, status: 200 | 404): Promise<FastifyReply> {
    if (index === undefined) {
      try {
        const html = renderIndexHtml(await readFile(join(webDistDir, 'index.html'), 'utf8'), options)
        index = { html, etag: `"${createHash('sha256').update(html).digest('base64url').slice(0, 27)}"` }
      } catch {
        return reply.code(404).type('text/plain; charset=utf-8').send("L'application web n'est pas construite.")
      }
    }
    reply.type('text/html; charset=utf-8').header('cache-control', REVALIDATE)
    // La page est revalidée à chaque visite (no-cache) : l'ETag permet de répondre 304 sans corps
    // au navigateur qui l'a déjà. Pas sur un chemin inconnu, où le statut 404 doit toujours partir.
    if (status === 200) {
      reply.header('etag', index.etag)
      if (etagMatches(request.headers['if-none-match'], index.etag)) return reply.code(304).send()
    }
    return reply.code(status).send(index.html)
  }

  // Contexte encapsulé : le hook `onRoute` ne voit que les routes des fichiers du SPA déclarées
  // par @fastify/static, et les marque `spaAsset` pour l'exemption de la limite de débit (voir
  // app.ts). Le marquage vient de la route trouvée, jamais de l'URL envoyée par le client.
  app.register(async (spa) => {
    spa.addHook('onRoute', (routeOptions) => {
      routeOptions.config = { ...routeOptions.config, spaAsset: true }
    })
    // index.html n'est jamais servi tel quel : il passe toujours par renderIndexHtml.
    // Cache : les fichiers de /assets/ ont un hash de contenu dans leur nom, ils sont donc gardés un
    // an sans revalidation ; tout le reste (icônes, robots.txt, page) est revalidé à chaque usage.
    // `preCompressed` sert les .br et .gz produits au build (apps/web/scripts/precompress.mjs).
    await spa.register(fastifyStatic, {
      root: webDistDir,
      wildcard: false,
      index: false,
      allowedPath: (pathName) => pathName !== '/index.html',
      preCompressed: true,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        const hashed = relative(webDistDir, filePath).split(sep)[0] === 'assets'
        reply.header('cache-control', hashed ? IMMUTABLE : REVALIDATE)
      },
    })

    // Repli du SPA. Il couvre tout le serveur, ce contexte n'ayant pas de préfixe. Il n'est pas une
    // route et n'est donc jamais compté par la limite de débit.
    spa.setNotFoundHandler(async (req, reply) => {
      const pathname = req.url.split('?')[0] ?? ''
      // /uploads : un fichier envoyé absent doit répondre 404, jamais la page de l'application.
      if (pathname.startsWith('/api') || pathname.startsWith('/health') || pathname.startsWith('/uploads')) {
        // Message affiché tel quel par le front : une route d'API inconnue signale en pratique un
        // serveur qui n'a pas la version attendue par la page.
        return reply.code(404).send({ error: "Cette fonctionnalité n'est pas disponible sur ce serveur." })
      }
      const readable = req.method === 'GET' || req.method === 'HEAD'
      // Route connue de l'application (rechargement ou lien direct) : la page, en 200.
      if (readable && (isSpaRoute(pathname) || pathname === '/index.html')) return sendIndex(req, reply, 200)
      // Fichier absent (`/sitemap.xml`, ancien bundle), `/.well-known/*` ou méthode d'écriture :
      // un 404 nu, jamais la page de l'application.
      if (!readable || looksLikeFile(pathname) || pathname.startsWith('/.well-known/')) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Introuvable.')
      }
      // Autre chemin inconnu : statut 404 pour les moteurs, mais la page de l'application comme
      // corps, qui affiche son écran « page introuvable » (RouteError) à un humain.
      return sendIndex(req, reply, 404)
    })
  })
}
