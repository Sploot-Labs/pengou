import { account } from './account'
import { common } from './common'
import { editor } from './editor'
import { host } from './host'
import { live } from './live'
import { player } from './player'

/** Fusion des catalogues de zone ; chaque zone d'écran ajoute le sien ici. */
export const catalog = {
  en: { ...common.en, ...account.en, ...host.en, ...editor.en, ...live.en, ...player.en },
  es: { ...common.es, ...account.es, ...host.es, ...editor.es, ...live.es, ...player.es },
}

export type WebKey = keyof typeof catalog.en
