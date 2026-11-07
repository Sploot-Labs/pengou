import { describe, expect, it, vi } from 'vitest'
import { createMailer, MemoryMailer, maskTokens, recipientDomain } from './index.js'

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

describe('createMailer none', () => {
  it('est désactivé et journalise sans lever', async () => {
    const log = logger()
    const mailer = createMailer({ transport: 'none' }, log, { nodeEnv: 'production' })
    expect(mailer.enabled).toBe(false)
    await expect(mailer.send(mail)).resolves.toBeUndefined()
    expect(log.info).toHaveBeenCalledTimes(1)
    const [obj] = log.info.mock.calls[0]
    expect(obj).toMatchObject({ kind: 'invitation', domain: 'example.org', subject: 'Bonjour' })
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('AbCdEf')
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('alice@')
  })

  it('journalise le texte masqué en développement', async () => {
    const log = logger()
    await createMailer({ transport: 'none' }, log, { nodeEnv: 'development' }).send(mail)
    const dump = JSON.stringify(log.info.mock.calls)
    expect(dump).toContain('AbCdEf…')
    expect(dump).not.toContain('AbCdEf0123456789')
  })
})

describe('maskTokens / recipientDomain', () => {
  it('masque les suites longues', () => {
    const out = maskTokens('…/invitations/AbCdEf0123456789xyzQRS')
    expect(out).toContain('AbCdEf…')
    expect(out).not.toContain('0123456789xyzQRS')
  })
  it('laisse les mots courts', () => {
    expect(maskTokens('Bonjour tout le monde')).toBe('Bonjour tout le monde')
  })
  it('extrait le domaine', () => {
    expect(recipientDomain('a@Example.ORG')).toBe('example.org')
    expect(recipientDomain('invalide')).toBe('inconnu')
  })
})

describe('MemoryMailer', () => {
  it('enregistre puis échoue une fois sur demande', async () => {
    const m = new MemoryMailer()
    expect(m.enabled).toBe(true)
    await m.send(mail)
    expect(m.sent).toEqual([mail])
    m.failNext()
    await expect(m.send(mail)).rejects.toThrow()
    await m.send(mail)
    expect(m.sent).toHaveLength(2)
  })
  it('peut être désactivé', () => {
    expect(new MemoryMailer({ enabled: false }).enabled).toBe(false)
  })
})
