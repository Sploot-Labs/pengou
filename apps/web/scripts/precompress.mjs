// Précompresse le build du SPA en Brotli et gzip (fichiers .br et .gz à côté des originaux), que
// le serveur sert directement selon l'en-tête Accept-Encoding (option `preCompressed` de
// @fastify/static, voir apps/server/src/static.ts). La compression maximale est faite une fois au
// build, au lieu d'une compression rapide à chaque requête par le reverse proxy.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const COMPRESSIBLE = /\.(js|mjs|css|svg|json|webmanifest|txt|ico|map)$/
const MIN_BYTES = 1024

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

export function precompress(dir) {
  let written = 0
  for (const file of listFiles(dir)) {
    if (!COMPRESSIBLE.test(file)) continue
    const source = readFileSync(file)
    if (source.length < MIN_BYTES) continue
    const br = brotliCompressSync(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    })
    const gz = gzipSync(source, { level: constants.Z_BEST_COMPRESSION })
    // Un fichier compressé plus gros que l'original ne servirait à rien.
    if (br.length < source.length) {
      writeFileSync(`${file}.br`, br)
      written++
    }
    if (gz.length < source.length) {
      writeFileSync(`${file}.gz`, gz)
      written++
    }
  }
  return written
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist')
  console.log(`précompression : ${precompress(dir)} fichiers écrits dans ${dir}`)
}
