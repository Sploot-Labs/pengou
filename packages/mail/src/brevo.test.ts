import { describe, expect, it, vi } from 'vitest'
import { createMailer, MailError } from './index.js'

const config = {
  transport: 'brevo' as const,
  from: 'Pengou <contact@pengou.fr>',
  replyTo: 'support@pengou.fr',
  brevoApiKey: 'xkeysib-SECRET-VALUE',
}
const mail = {
  to: 'alice@example.org',
  subject: 'Sujet',
  text: 'texte',
  html: '<p>html</p>',
  kind: 'verify-email' as const,
}
const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const asFetch = (f: unknown) => f as typeof globalThis.fetch

describe('BrevoMailer', () => {
  it('envoie la requête attendue', async () => {
    const fetch = vi.fn(async () => new Response('{"messageId":"x"}', { status: 201 }))
    const mailer = createMailer(config, log(), { fetch: asFetch(fetch) })
    expect(mailer.enabled).toBe(true)
    await mailer.send(mail)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['api-key']).toBe(config.brevoApiKey)
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'Pengou', email: 'contact@pengou.fr' },
      to: [{ email: 'alice@example.org' }],
      replyTo: { email: 'support@pengou.fr' },
      subject: 'Sujet',
      htmlContent: '<p>html</p>',
      textContent: 'texte',
    })
  })

  it('transforme une réponse 401 en MailError sans la clé', async () => {
    const fetch = vi.fn(
      async () => new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
    )
    const mailer = createMailer(config, log(), { fetch: asFetch(fetch) })
    const err = await mailer.send(mail).catch((e) => e)
    expect(err).toBeInstanceOf(MailError)
    expect(err.detail).toMatchObject({ status: 401, code: 'unauthorized' })
    expect(err.message).not.toContain(config.brevoApiKey)
  })

  it('transforme un délai dépassé en MailError', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError')
    })
    const mailer = createMailer(config, log(), { fetch: asFetch(fetch) })
    const err = await mailer.send(mail).catch((e) => e)
    expect(err).toBeInstanceOf(MailError)
    expect(err.message).not.toContain(config.brevoApiKey)
  })
})
