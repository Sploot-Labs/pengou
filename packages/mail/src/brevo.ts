import type { MailConfig } from '@splootlabs/shared'
import { MailError, parseAddress, type Mailer, type OutgoingMail } from './mailer.js'

type BrevoConfig = Extract<MailConfig, { transport: 'brevo' }>

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const TIMEOUT_MS = 10_000

export class BrevoMailer implements Mailer {
  readonly enabled = true

  constructor(
    private readonly config: BrevoConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const sender = parseAddress(this.config.from)
    const body = {
      sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
      to: [{ email: mail.to }],
      ...(this.config.replyTo ? { replyTo: { email: parseAddress(this.config.replyTo).email } } : {}),
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }
    let response: Response
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.config.brevoApiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new MailError(timeout ? 'Délai dépassé pour Brevo' : 'Brevo injoignable')
    }
    if (response.ok) return
    let code: string | undefined
    try {
      const data = (await response.json()) as { code?: unknown }
      if (typeof data.code === 'string') code = data.code
    } catch {
      // Corps absent ou non JSON : seul le statut est conservé.
    }
    throw new MailError(`Brevo a refusé l'envoi (HTTP ${response.status}${code ? `, ${code}` : ''})`, {
      status: response.status,
      ...(code ? { code } : {}),
    })
  }
}
