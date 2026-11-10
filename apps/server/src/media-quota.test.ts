import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEDIA_MAX_FILES, MEDIA_UNVERIFIED_QUOTA_BYTES, mediaQuotaRefusal } from './media-quota'

const MB = 1024 * 1024
const verified = { tenancyMode: 'multi', mailEnabled: true, emailVerified: true, quotaBytes: 3 * MB } as const

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'quota-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('mediaQuotaRefusal', () => {
  it('accepte tant que le dossier du workspace n’existe pas', async () => {
    expect(await mediaQuotaRefusal(join(dir, 'absent'), MB, verified)).toBeNull()
  })

  it('accepte une image qui remplit exactement le quota', async () => {
    writeFileSync(join(dir, 'a.png'), Buffer.alloc(2 * MB))
    expect(await mediaQuotaRefusal(dir, MB, verified)).toBeNull()
  })

  it('refuse au-delà du quota, avec la limite dans le message', async () => {
    writeFileSync(join(dir, 'a.png'), Buffer.alloc(2 * MB))
    expect(await mediaQuotaRefusal(dir, MB + 1, verified)).toBe('Espace images du workspace plein (3 Mo max).')
  })

  it('refuse au-delà du nombre maximal de fichiers, même très petits', async () => {
    for (let i = 0; i < MEDIA_MAX_FILES; i++) writeFileSync(join(dir, `${i}.png`), 'x')
    expect(await mediaQuotaRefusal(dir, 1, { ...verified, quotaBytes: 100 * MB })).not.toBeNull()
  })

  it('adresse non confirmée : plafond réduit et invitation à confirmer', async () => {
    const opts = { ...verified, emailVerified: false, quotaBytes: 100 * MB }
    writeFileSync(join(dir, 'a.png'), Buffer.alloc(MEDIA_UNVERIFIED_QUOTA_BYTES - 1))
    expect(await mediaQuotaRefusal(dir, 1, opts)).toBeNull()
    expect(await mediaQuotaRefusal(dir, 2, opts)).toBe("Confirmez votre adresse e-mail pour envoyer d'autres images.")
  })

  it("sans envoi d'e-mails, l'adresse non confirmée garde le quota normal", async () => {
    writeFileSync(join(dir, 'a.png'), Buffer.alloc(MEDIA_UNVERIFIED_QUOTA_BYTES))
    const opts = { ...verified, mailEnabled: false, emailVerified: false, quotaBytes: 100 * MB }
    expect(await mediaQuotaRefusal(dir, MB, opts)).toBeNull()
  })

  it('ne s’applique pas en mode single', async () => {
    writeFileSync(join(dir, 'a.png'), Buffer.alloc(4 * MB))
    expect(await mediaQuotaRefusal(dir, MB, { ...verified, tenancyMode: 'single' })).toBeNull()
  })
})
