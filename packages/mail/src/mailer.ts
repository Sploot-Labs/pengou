import type { MailConfig } from '@splootlabs/shared'
import { BrevoMailer } from './brevo.js'
import { maskTokens, recipientDomain } from './mask.js'
import { SmtpMailer } from './smtp.js'

export type MailKind = 'invitation' | 'reset-password' | 'password-changed' | 'verify-email'

export type OutgoingMail = { to: string; subject: string; text: string; html: string; kind: MailKind }

export interface Mailer {
  readonly enabled: boolean
  send(mail: OutgoingMail): Promise<void>
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly detail?: { status?: number; code?: string },
  ) {
    super(message)
    this.name = 'MailError'
  }
}

/** Compatible avec un journal pino/Fastify (`app.log`) : objet de contexte puis message. */
export type MailLogger = {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

/** Mailer de test : conserve les messages envoyés en mémoire. */
export class MemoryMailer implements Mailer {
  enabled: boolean
  sent: OutgoingMail[] = []
  private nextError: Error | null = null

  constructor(opts: { enabled?: boolean } = {}) {
    this.enabled = opts.enabled ?? true
  }

  failNext(error: Error = new MailError('Échec simulé')): void {
    this.nextError = error
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (this.nextError) {
      const error = this.nextError
      this.nextError = null
      throw error
    }
    this.sent.push(mail)
  }
}

/** Repli sans transport : journalise l'envoi (jamais le texte en production). */
class LogMailer implements Mailer {
  readonly enabled = false

  constructor(
    private readonly logger: MailLogger,
    private readonly nodeEnv: string | undefined,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const entry: Record<string, unknown> = {
      kind: mail.kind,
      domain: recipientDomain(mail.to),
      subject: mail.subject,
    }
    if (this.nodeEnv !== 'production') entry.text = maskTokens(mail.text)
    this.logger.info(entry, 'E-mail non envoyé (aucun transport configuré)')
  }
}

/** Sépare « Nom <a@b> » en nom et adresse ; une adresse seule n'a pas de nom. */
export function parseAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value)
  if (!match) return { email: value.trim() }
  const name = match[1]?.replace(/^"(.*)"$/, '$1')
  return name ? { name, email: match[2].trim() } : { email: match[2].trim() }
}

export function createMailer(
  config: MailConfig,
  logger: MailLogger,
  opts: { nodeEnv?: string; fetch?: typeof fetch } = {},
): Mailer {
  switch (config.transport) {
    case 'smtp':
      return new SmtpMailer(config)
    case 'brevo':
      return new BrevoMailer(config, opts.fetch)
    default:
      return new LogMailer(logger, opts.nodeEnv)
  }
}
