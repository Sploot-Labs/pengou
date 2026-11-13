import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Espace accordé tant que l'adresse e-mail n'est pas confirmée. */
export const MEDIA_UNVERIFIED_QUOTA_BYTES = 10 * 1024 * 1024

/** Nombre maximal d'images par workspace : borne le listing, et le disque face aux très petits fichiers. */
export const MEDIA_MAX_FILES = 1000

type Usage = { bytes: number; files: number }

async function tenantUsage(dir: string): Promise<Usage> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, files: 0 }
    throw e
  }
  const sizes = await Promise.all(names.map(async (name) => (await stat(join(dir, name))).size))
  return { bytes: sizes.reduce((sum, size) => sum + size, 0), files: names.length }
}

type QuotaOpts = {
  tenancyMode: 'single' | 'multi'
  mailEnabled: boolean
  emailVerified: boolean
  quotaBytes: number
}

/**
 * Message de refus si l'image de `incomingBytes` octets ferait dépasser l'espace du workspace dont
 * `dir` est le dossier, `null` sinon. Comme le quota de quiz, ne s'applique qu'en multi-tenant : un
 * auto-hébergeur en mode single gère son propre disque. Sans garde entre envois simultanés : un
 * dépassement de quelques images reste possible, le débit par IP le borne.
 */
export async function mediaQuotaRefusal(dir: string, incomingBytes: number, opts: QuotaOpts): Promise<string | null> {
  if (opts.tenancyMode !== 'multi') return null
  const unverified = opts.mailEnabled && !opts.emailVerified
  const limit = unverified ? Math.min(MEDIA_UNVERIFIED_QUOTA_BYTES, opts.quotaBytes) : opts.quotaBytes
  const usage = await tenantUsage(dir)
  if (usage.bytes + incomingBytes <= limit && usage.files < MEDIA_MAX_FILES) return null
  if (unverified) return "Confirmez votre adresse e-mail pour envoyer d'autres images."
  return `Espace images du workspace plein (${Math.round(limit / (1024 * 1024))} Mo max).`
}
