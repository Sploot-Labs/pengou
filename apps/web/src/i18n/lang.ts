import { DEFAULT_LANG, isLang, matchLang, type Lang } from '@splootlabs/shared/i18n'
import { common } from './catalog/common'

export const LANG_STORAGE_KEY = 'pengou.lang'

let current: Lang | null = null
const listeners = new Set<() => void>()

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStorage(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // Stockage inaccessible : la langue vaut pour la session seulement.
  }
}

/** Titre de l'onglet en français, identique à celui de index.html. */
const DOCUMENT_TITLE = "Pengou, l'application : rejoindre ou animer une partie"

function applyDocumentLang(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.title = lang === 'fr' ? DOCUMENT_TITLE : common[lang][DOCUMENT_TITLE]
}

function detect(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('lang')
    if (params.has('lang')) {
      // Paramètre consommé : le retirer de l'adresse pour qu'un rechargement ne défasse pas un choix ultérieur.
      params.delete('lang')
      const search = params.toString()
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
      )
    }
    if (isLang(fromUrl)) {
      writeStorage(fromUrl)
      return fromUrl
    }
  } catch {
    // URL illisible : on passe à la suite.
  }
  const stored = readStorage()
  if (isLang(stored)) return stored
  return matchLang(typeof navigator !== 'undefined' ? navigator.languages : null)
}

/** Langue courante, déterminée à la première lecture. */
export function getLang(): Lang {
  if (current === null) {
    current = detect()
    applyDocumentLang(current)
  }
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  if (typeof window !== 'undefined') writeStorage(lang)
  applyDocumentLang(lang)
  for (const listener of [...listeners]) listener()
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Détection dès l'évaluation du module : le routeur (routes.tsx) lit l'adresse à sa création, et
// `?lang=` doit en être retiré avant, sinon sa position gardée en mémoire le réécrirait.
if (typeof window !== 'undefined') getLang()
