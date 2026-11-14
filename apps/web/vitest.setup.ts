// Setup partagé. Chargé pour TOUS les tests (node et jsdom) : les stubs
// spécifiques au DOM sont gardés par `typeof window` pour ne rien casser en node.
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'

if (typeof window !== 'undefined') {
  // jsdom n'implémente pas matchMedia ; par défaut on répond « pas de
  // préférence reduced-motion » (les tests reduced-motion la surchargent).
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  }

  // jsdom annonce `en-US` : sans cette remise à zéro, tous les tests existants basculeraient en anglais.
  beforeEach(async () => {
    const { setLang } = await import('./src/i18n/lang')
    setLang('fr')
  })
}

afterEach(() => {
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme')
})
