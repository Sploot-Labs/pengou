import { createRequire } from 'node:module'
import { resolve4, resolve6, resolveMx } from 'node:dns/promises'
import type { MailLogger } from './mailer.js'
import { recipientDomain } from './mask.js'

export type DnsResolver = {
  resolveMx(d: string): Promise<{ exchange: string; priority: number }[]>
  resolve4(d: string): Promise<string[]>
  resolve6(d: string): Promise<string[]>
}

export type Deliverability = 'ok' | 'disposable' | 'undeliverable'

export const DELIVERABILITY_MESSAGES: Record<'disposable' | 'undeliverable', string> = {
  disposable: 'Les adresses e-mail jetables ne sont pas acceptées.',
  undeliverable: 'Ce domaine ne semble pas pouvoir recevoir d\'e-mails. Vérifiez l\'adresse.',
}

const DEFAULT_TIMEOUT_MS = 3000
/** Codes DNS qui signifient franchement « ce domaine n'existe pas ou n'a pas d'enregistrement ». */
const NEGATIVE_CODES = new Set(['ENOTFOUND', 'ENODATA'])

const defaultResolver: DnsResolver = { resolveMx, resolve4, resolve6 }

let disposableDomains: Set<string> | null = null

function loadDisposable(): Set<string> {
  if (!disposableDomains) {
    // Le paquet expose un tableau JSON de domaines (champ main : index.json).
    const list = createRequire(import.meta.url)('disposable-email-domains') as string[]
    disposableDomains = new Set(list)
  }
  return disposableDomains
}

/** Le domaine ou l'un de ses domaines parents figure-t-il dans la liste des jetables ? */
function isDisposable(domain: string): boolean {
  const set = loadDisposable()
  const labels = domain.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    if (set.has(labels.slice(i).join('.'))) return true
  }
  return false
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'INCONNU'
}

class DnsTimeout extends Error {}

/** Résultat DNS brut : 'found', 'negative' (réponse négative franche) ; toute autre erreur est levée. */
async function lookup<T>(call: () => Promise<T[]>): Promise<'found' | 'negative'> {
  try {
    const result = await call()
    return result.length > 0 ? 'found' : 'negative'
  } catch (err) {
    if (NEGATIVE_CODES.has(errorCode(err))) return 'negative'
    throw err
  }
}

async function dnsVerdict(domain: string, resolver: DnsResolver): Promise<Deliverability> {
  let mx: { exchange: string; priority: number }[] = []
  try {
    mx = await resolver.resolveMx(domain)
  } catch (err) {
    if (!NEGATIVE_CODES.has(errorCode(err))) throw err
  }
  if (mx.length > 0) {
    // MX nul (RFC 7505) : le domaine déclare ne recevoir aucun courrier.
    const usable = mx.some((r) => r.exchange !== '' && r.exchange !== '.')
    return usable ? 'ok' : 'undeliverable'
  }
  // Pas de MX : règle du MX implicite, on regarde A puis AAAA.
  if ((await lookup(() => resolver.resolve4(domain))) === 'found') return 'ok'
  if ((await lookup(() => resolver.resolve6(domain))) === 'found') return 'ok'
  return 'undeliverable'
}

export async function checkEmailDeliverable(
  email: string,
  opts: { dns: boolean; resolver?: DnsResolver; timeoutMs?: number; logger?: MailLogger },
): Promise<Deliverability> {
  // Point final retiré : `yopmail.com.` (nom absolu) désigne le même domaine que `yopmail.com`.
  const domain = recipientDomain(email.trim()).replace(/\.+$/, '')
  if (domain === 'inconnu' || domain === '') return 'ok'
  if (isDisposable(domain)) return 'disposable'
  if (!opts.dns) return 'ok'

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DnsTimeout()), timeoutMs)
  })
  try {
    return await Promise.race([dnsVerdict(domain, opts.resolver ?? defaultResolver), timeout])
  } catch (err) {
    // Échec non franc : on laisse passer, sans jamais journaliser la partie locale.
    const reason = err instanceof DnsTimeout ? 'ETIMEOUT_GLOBAL' : errorCode(err)
    opts.logger?.warn({ domain, reason }, 'Contrôle DNS du domaine impossible, adresse acceptée')
    return 'ok'
  } finally {
    clearTimeout(timer)
  }
}
