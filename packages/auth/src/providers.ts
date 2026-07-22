import type { AppConfig } from '@splootlabs/shared'

export function enabledSocialProviders(
  config: Pick<AppConfig, 'oauth'>,
): Record<string, { clientId: string; clientSecret: string }> {
  const out: Record<string, { clientId: string; clientSecret: string }> = {}
  for (const [name, creds] of Object.entries(config.oauth ?? {})) {
    if (creds?.clientId && creds?.clientSecret) {
      out[name] = { clientId: creds.clientId, clientSecret: creds.clientSecret }
    }
  }
  return out
}
