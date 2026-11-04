import { describe, expect, it, vi } from 'vitest'
import { MailError, MemoryMailer, sendAndLog } from './index.js'

const mail = {
  to: 'alice@example.org',
  subject: 'Bonjour',
  text: 'Lien : https://app.pengou.fr/invitations/AbCdEf0123456789xyzQRS',
  html: '<p>x</p>',
  kind: 'invitation' as const,
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('sendAndLog', () => {
  it('renvoie true et journalise le succès sans adresse ni lien', async () => {
    const log = logger()
    const mailer = new MemoryMailer()
    await expect(sendAndLog(mailer, mail, log, 'smtp')).resolves.toBe(true)
    expect(mailer.sent).toHaveLength(1)
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0][0]).toEqual({ kind: 'invitation', transport: 'smtp', domain: 'example.org', ok: true })
    const dump = JSON.stringify(log.info.mock.calls)
    expect(dump).not.toContain('alice@')
    expect(dump).not.toContain('AbCdEf')
  })

  it("renvoie false et journalise l'échec sans lever", async () => {
    const log = logger()
    const mailer = new MemoryMailer()
    mailer.failNext(new MailError('Brevo a refusé'))
    await expect(sendAndLog(mailer, mail, log, 'brevo')).resolves.toBe(false)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toEqual({
      kind: 'invitation', transport: 'brevo', domain: 'example.org', err: 'Brevo a refusé',
    })
    const dump = JSON.stringify(log.error.mock.calls)
    expect(dump).not.toContain('alice@')
    expect(dump).not.toContain('AbCdEf')
  })

  it("masque un token ou l'adresse qui figureraient dans le message d'erreur", async () => {
    const log = logger()
    const mailer = new MemoryMailer()
    mailer.failNext(new Error('550 alice@example.org refusé, jeton AbCdEf0123456789xyzQRS'))
    await sendAndLog(mailer, mail, log, 'smtp')
    const dump = JSON.stringify(log.error.mock.calls)
    expect(dump).not.toContain('AbCdEf0123456789')
    expect(dump).not.toContain('alice@')
  })
})
