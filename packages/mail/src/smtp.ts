import type { MailConfig } from '@splootlabs/shared'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js'
import { MailError, type Mailer, type OutgoingMail } from './mailer.js'

type SmtpConfig = Extract<MailConfig, { transport: 'smtp' }>

const TIMEOUT_MS = 10_000

/** 465 : TLS implicite ; autres ports : STARTTLS obligatoire sauf si SMTP_REQUIRE_TLS=false (relais local). */
export function smtpTransportOptions(config: SmtpConfig): SMTPTransport.Options {
  const { host, port, user, password, requireTls } = config.smtp
  const implicitTls = port === 465
  return {
    host,
    port,
    secure: implicitTls,
    ...(implicitTls ? {} : { requireTLS: requireTls }),
    ...(user !== undefined ? { auth: { user, pass: password ?? '' } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  }
}

export class SmtpMailer implements Mailer {
  readonly enabled = true
  private readonly transport: Transporter

  constructor(
    private readonly config: SmtpConfig,
    transport?: Transporter,
  ) {
    this.transport = transport ?? nodemailer.createTransport(smtpTransportOptions(config))
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        ...(this.config.replyTo ? { replyTo: this.config.replyTo } : {}),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
    } catch (err) {
      // Seul le code nodemailer est conservé : le message peut citer l'hôte ou des identifiants.
      const code = (err as { code?: string }).code
      throw new MailError(`Échec de l'envoi SMTP${code ? ` (${code})` : ''}`, code ? { code } : undefined)
    }
  }
}
