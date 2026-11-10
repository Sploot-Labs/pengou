import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import type { Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser, resolveContextOr403 } from '../require-user.js'
import { sniffImageType } from '../media-sniff.js'
import { mediaQuotaRefusal } from '../media-quota.js'

/** Taille maximale d'une image envoyée : 2 Mio (2 097 152 octets inclus). */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024

type Deps = { systemDb: Db; config: AppConfig; mailEnabled?: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `POST /api/media` : envoi d'une image de question (multipart, champ fichier `file`).
 *
 * Le plugin multipart est enregistré dans un contexte encapsulé : son parseur
 * `multipart/form-data` ne concerne que cette route, les autres routes gardent leur parsing
 * JSON inchangé. Les hooks globaux (helmet, rate limit) restent hérités.
 *
 * Sécurité : le nom de fichier et le Content-Type du client sont ignorés. Le format est déduit
 * des octets, le tenant vient de `resolveContextOr403` uniquement, le chemin est construit à
 * partir d'un uuid généré par le serveur, et rien n'est écrit avant que toutes les
 * vérifications (taille, format) soient passées.
 */
export function registerMediaRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, config } = deps

  app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 10, fieldSize: 1024 },
    })

    scope.post('/api/media', { preHandler: requireUser }, async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return
      if (!UUID.test(context.tenantId)) throw new Error('Identifiant de tenant inattendu.')

      if (!request.isMultipart()) return reply.code(400).send({ error: 'Aucun fichier reçu.' })
      const data = await request.file()
      if (!data) return reply.code(400).send({ error: 'Aucun fichier reçu.' })

      let bytes: Buffer
      try {
        bytes = await data.toBuffer()
      } catch (e) {
        if (e instanceof scope.multipartErrors.RequestFileTooLargeError) {
          return reply.code(413).send({ error: 'Image trop lourde (2 Mo max).' })
        }
        throw e
      }
      if (data.file.truncated || bytes.length > MEDIA_MAX_BYTES) {
        return reply.code(413).send({ error: 'Image trop lourde (2 Mo max).' })
      }

      const kind = sniffImageType(bytes)
      if (!kind) {
        return reply.code(415).send({ error: 'Format non pris en charge (PNG, JPEG, WebP ou GIF).' })
      }

      const dir = join(config.mediaDir, context.tenantId)
      const refusal = await mediaQuotaRefusal(dir, bytes.length, {
        tenancyMode: config.tenancyMode,
        mailEnabled: deps.mailEnabled === true,
        emailVerified: request.user.emailVerified,
        quotaBytes: config.mediaQuotaBytes,
      })
      if (refusal) return reply.code(403).send({ error: refusal })

      const fileName = `${randomUUID()}.${kind}`
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, fileName), bytes, { flag: 'wx' })
      return reply.code(201).send({ url: `/uploads/${context.tenantId}/${fileName}` })
    })
  })
}
