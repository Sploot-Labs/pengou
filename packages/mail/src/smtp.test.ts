import nodemailer from 'nodemailer'
import { describe, expect, it } from 'vitest'
import { SmtpMailer, smtpTransportOptions } from './smtp.js'

const base = { transport: 'smtp' as const, from: 'Pengou <contact@pengou.fr>', replyTo: 'support@pengou.fr' }

describe('smtpTransportOptions', () => {
  it('port 465 : TLS implicite', () => {
    const o = smtpTransportOptions({ ...base, smtp: { host: 'h', port: 465, user: 'u', password: 'p', requireTls: true } })
    expect(o).toMatchObject({ host: 'h', port: 465, secure: true, auth: { user: 'u', pass: 'p' } })
    expect(o.connectionTimeout).toBe(10_000)
    expect(o.greetingTimeout).toBe(10_000)
    expect(o.socketTimeout).toBe(10_000)
  })
  it('port 587 : STARTTLS obligatoire', () => {
    const o = smtpTransportOptions({ ...base, smtp: { host: 'h', port: 587, requireTls: true } })
    expect(o).toMatchObject({ secure: false, requireTLS: true })
    expect(o.auth).toBeUndefined()
  })
  it('requireTls false : STARTTLS non exigé (relais local)', () => {
    const o = smtpTransportOptions({ ...base, smtp: { host: 'mailpit', port: 1025, requireTls: false } })
    expect(o).toMatchObject({ secure: false, requireTLS: false })
  })
  it('port 465 reste en TLS implicite même avec requireTls false', () => {
    const o = smtpTransportOptions({ ...base, smtp: { host: 'h', port: 465, requireTls: false } })
    expect(o).toMatchObject({ secure: true })
    expect(o.requireTLS).toBeUndefined()
  })
})

describe('SmtpMailer', () => {
  it("compose l'enveloppe", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true })
    const mailer = new SmtpMailer({ ...base, smtp: { host: 'h', port: 587, requireTls: true } }, transport)
    expect(mailer.enabled).toBe(true)
    let message: Record<string, unknown> = {}
    const orig = transport.sendMail.bind(transport)
    transport.sendMail = (async (m: never) => {
      const info = await orig(m)
      message = JSON.parse((info as unknown as { message: string }).message)
      return info
    }) as typeof transport.sendMail
    await mailer.send({ to: 'a@example.org', subject: 'S', text: 'T', html: '<p>H</p>', kind: 'reset-password' })
    expect(message.from).toMatchObject({ address: 'contact@pengou.fr', name: 'Pengou' })
    expect(message.replyTo).toMatchObject([{ address: 'support@pengou.fr' }])
    expect(message.to).toMatchObject([{ address: 'a@example.org' }])
    expect(message.text).toBe('T')
    expect(message.html).toBe('<p>H</p>')
  })
})
