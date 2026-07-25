// Setup partagé. Chargé pour TOUS les tests (node et jsdom) : les stubs
// spécifiques au DOM sont gardés par `typeof window` pour ne rien casser en node.
import { afterEach, expect } from 'vitest'

if (typeof window !== 'undefined') {
  // jest-dom matchers for jsdom tests
  try {
    const jestDomMatchers = require('@testing-library/jest-dom/matchers')
    expect.extend(jestDomMatchers)
  } catch {
    // If jest-dom is not available, continue without it
  }

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
}

afterEach(() => {
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme')
})
