import type { Mailer, MailLogger, OutgoingMail } from './mailer.js'
import { maskTokens, recipientDomain } from './mask.js'

/**
 * Envoie un message et journalise l'issue (gabarit, transport, domaine du destinataire), sans
 * jamais l'adresse complète, l'URL ni le token. Ne lève jamais : renvoie vrai si l'envoi a réussi.
 */
export async function sendAndLog(
  mailer: Mailer,
  mail: OutgoingMail,
  logger: MailLogger,
  transport: string,
): Promise<boolean> {
  const domain = recipientDomain(mail.to)
  try {
    await mailer.send(mail)
    logger.info({ kind: mail.kind, transport, domain, ok: true }, 'E-mail envoyé')
    return true
  } catch (error) {
    // Un serveur SMTP peut citer l'adresse ou le lien dans son refus : on les retire du message.
    const raw = error instanceof Error ? error.message : String(error)
    const err = maskTokens(raw.split(mail.to).join(`…@${domain}`))
    logger.error({ kind: mail.kind, transport, domain, err }, "Échec de l'envoi de l'e-mail")
    return false
  }
}
