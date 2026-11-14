import { useSyncExternalStore } from 'react'
import { formatDate, formatNumber, t, tc, tp } from './t'
import { getLang, setLang, subscribeLang } from './lang'

/** Même API que `t.ts`, et le composant se réaffiche au changement de langue. */
export function useT() {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang)
  return { t, tc, tp, formatDate, formatNumber, lang, setLang }
}
